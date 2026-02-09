// =============================================================================
// PATCHED: PredictionService.getCashoutValue()
// =============================================================================
// Changes:
// 1. Added odds staleness check — refuses cashout if odds are older than threshold
// 2. Better error messaging when odds are stale
// =============================================================================

// Add this constant near the top of src/services/predictions.ts:

const CASHOUT_ODDS_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes — configurable

// Replace the getCashoutValue method with this:

async getCashoutValue(predictionId: string, userId: string) {
  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    include: { event: true },
  });

  if (!prediction) {
    throw AppError.notFound('Prediction');
  }

  if (prediction.userId !== userId) {
    throw AppError.forbidden('You can only cash out your own predictions');
  }

  if (prediction.status !== 'PENDING' || prediction.cashedOutAt) {
    throw new AppError('CASHOUT_UNAVAILABLE', 'Prediction is not eligible for cashout', 409);
  }

  if (prediction.event.status === 'SETTLED' || prediction.event.status === 'CANCELLED') {
    throw new AppError('CASHOUT_UNAVAILABLE', 'Event is already settled', 409);
  }

  if (!prediction.event.externalEventId || !prediction.event.externalSportKey) {
    throw new AppError('CASHOUT_UNAVAILABLE', 'Event is missing odds mapping', 409);
  }

  // Fetch fresh odds from The Odds API
  const odds = await OddsApiService.getEventOdds(
    prediction.event.externalSportKey,
    prediction.event.externalEventId
  );

  if (!odds) {
    throw new AppError('CASHOUT_UNAVAILABLE', 'Unable to fetch live odds', 409);
  }

  // -----------------------------------------------------------------------
  // NEW: Staleness check — ensure odds are fresh enough for cashout
  // -----------------------------------------------------------------------
  const oddsAge = Date.now() - new Date(odds.updatedAt).getTime();
  if (oddsAge > CASHOUT_ODDS_MAX_AGE_MS) {
    throw new AppError(
      'CASHOUT_UNAVAILABLE',
      'Odds data is too stale for cashout. Please try again in a moment.',
      409
    );
  }

  const outcomeOdds = odds.outcomes.find(
    (outcome) =>
      outcome.name.trim().toLowerCase() === prediction.predictedOutcome.trim().toLowerCase()
  );

  if (!outcomeOdds) {
    throw new AppError('CASHOUT_UNAVAILABLE', 'Outcome not found in live odds', 409);
  }

  const originalOdds = prediction.originalOdds?.toNumber();
  if (!originalOdds) {
    throw new AppError('CASHOUT_UNAVAILABLE', 'Original odds not available', 409);
  }

  const eventStarted = prediction.event.startsAt.getTime() <= Date.now();
  const cashoutValue = calculateCashoutValue(
    prediction.stakeAmount,
    originalOdds,
    outcomeOdds.price,
    eventStarted
  );

  return {
    predictionId,
    cashoutValue,
    currentOdds: outcomeOdds.price,
    originalOdds,
    eventStarted,
    oddsAge: Math.round(oddsAge / 1000), // seconds, for client display
    updatedAt: odds.updatedAt,
  };
},
