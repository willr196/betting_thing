// =============================================================================
// PATCHED: EventService.settle()
// =============================================================================
// Changes:
// 1. Moved event status check INSIDE the transaction with FOR UPDATE lock
// 2. Moved prediction fetch INSIDE the transaction to prevent stale reads
// 3. Added transaction timeout for safety
// 4. Skips predictions that aren't PENDING (e.g., already cashed out)
// =============================================================================

// Replace the existing settle() method in src/services/events.ts with this:

async settle(
  eventId: string,
  finalOutcome: string,
  settledBy: string
): Promise<SettlementResult> {
  // Execute settlement entirely within a single atomic transaction
  const result = await prisma.$transaction(async (tx) => {
    // -----------------------------------------------------------------------
    // STEP 1: Lock the event row and verify status inside the transaction
    // This prevents double-settlement from concurrent calls
    // -----------------------------------------------------------------------
    const [lockedEvent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        outcomes: string[];
        payoutMultiplier: number;
        finalOutcome: string | null;
      }>
    >`SELECT "id", "status", "outcomes", "payoutMultiplier", "finalOutcome"
      FROM "Event"
      WHERE "id" = ${eventId}
      FOR UPDATE`;

    if (!lockedEvent) {
      throw AppError.notFound('Event');
    }

    if (lockedEvent.status === 'SETTLED') {
      throw new AppError('EVENT_ALREADY_SETTLED', 'Event has already been settled', 400);
    }

    if (lockedEvent.status === 'CANCELLED') {
      throw new AppError('EVENT_ALREADY_SETTLED', 'Event was cancelled', 400);
    }

    // Validate outcome against event's possible outcomes
    if (!lockedEvent.outcomes.includes(finalOutcome)) {
      throw new AppError(
        'INVALID_OUTCOME',
        `Invalid outcome. Must be one of: ${lockedEvent.outcomes.join(', ')}`,
        400
      );
    }

    // -----------------------------------------------------------------------
    // STEP 2: Fetch PENDING predictions inside the transaction
    // This ensures we don't process predictions that were cashed out
    // between our read and the transaction start
    // -----------------------------------------------------------------------
    const predictions = await tx.prediction.findMany({
      where: {
        eventId,
        status: 'PENDING',
      },
      include: { user: true },
    });

    // -----------------------------------------------------------------------
    // STEP 3: Process each prediction
    // -----------------------------------------------------------------------
    let winners = 0;
    let losers = 0;
    let totalPayout = 0;

    for (const prediction of predictions) {
      const isWinner = prediction.predictedOutcome === finalOutcome;

      if (isWinner) {
        const odds = prediction.originalOdds?.toNumber() ?? lockedEvent.payoutMultiplier;
        const payout = Math.floor(prediction.stakeAmount * odds);

        await PointsLedgerService.credit(
          {
            userId: prediction.userId,
            amount: payout,
            type: 'PREDICTION_WIN',
            referenceType: 'PREDICTION',
            referenceId: prediction.id,
            description: `Winnings for prediction ${prediction.id}`,
          },
          tx
        );

        await tx.prediction.update({
          where: { id: prediction.id },
          data: {
            status: 'WON',
            payout,
            settledAt: new Date(),
          },
        });

        winners++;
        totalPayout += payout;
      } else {
        // Mark as lost (tokens already deducted at stake time)
        await tx.prediction.update({
          where: { id: prediction.id },
          data: {
            status: 'LOST',
            payout: 0,
            settledAt: new Date(),
          },
        });

        losers++;
      }
    }

    // -----------------------------------------------------------------------
    // STEP 4: Mark event as settled
    // -----------------------------------------------------------------------
    await tx.event.update({
      where: { id: eventId },
      data: {
        status: 'SETTLED',
        finalOutcome,
        settledBy,
        settledAt: new Date(),
      },
    });

    return {
      eventId,
      finalOutcome,
      totalPredictions: predictions.length,
      winners,
      losers,
      totalPayout,
      settledAt: new Date(),
    };
  }, {
    // Transaction timeout: 30 seconds (adjust if events can have hundreds of predictions)
    timeout: 30000,
  });

  return result;
},
