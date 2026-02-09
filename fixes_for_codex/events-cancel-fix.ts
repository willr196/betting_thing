// =============================================================================
// PATCHED: EventService.cancel()
// =============================================================================
// Same pattern as settle() — lock event row inside transaction, re-check status,
// and fetch predictions inside the transaction.
// =============================================================================

// Replace the existing cancel() method in src/services/events.ts with this:

async cancel(eventId: string, cancelledBy: string): Promise<{ refunded: number }> {
  const result = await prisma.$transaction(async (tx) => {
    // Lock the event row and verify status
    const [lockedEvent] = await tx.$queryRaw<
      Array<{ id: string; status: string }>
    >`SELECT "id", "status"
      FROM "Event"
      WHERE "id" = ${eventId}
      FOR UPDATE`;

    if (!lockedEvent) {
      throw AppError.notFound('Event');
    }

    if (lockedEvent.status === 'SETTLED') {
      throw new AppError('EVENT_ALREADY_SETTLED', 'Cannot cancel a settled event', 400);
    }

    if (lockedEvent.status === 'CANCELLED') {
      throw new AppError('EVENT_ALREADY_SETTLED', 'Event is already cancelled', 400);
    }

    // Fetch PENDING predictions inside the transaction
    const predictions = await tx.prediction.findMany({
      where: {
        eventId,
        status: 'PENDING',
      },
    });

    let refunded = 0;

    for (const prediction of predictions) {
      await LedgerService.refundPrediction(
        prediction.userId,
        prediction.stakeAmount,
        prediction.id,
        tx
      );

      await tx.prediction.update({
        where: { id: prediction.id },
        data: {
          status: 'REFUNDED',
          settledAt: new Date(),
        },
      });

      refunded++;
    }

    await tx.event.update({
      where: { id: eventId },
      data: {
        status: 'CANCELLED',
        settledBy: cancelledBy,
        settledAt: new Date(),
      },
    });

    return { refunded };
  }, {
    timeout: 30000,
  });

  return result;
},
