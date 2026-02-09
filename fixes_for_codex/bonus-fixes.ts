// =============================================================================
// BONUS FIX 1: Remove dead methods from LedgerService
// =============================================================================
// These methods exist in src/services/ledger.ts but are never called because
// settlement and cashout correctly use PointsLedgerService instead.
// Remove them to avoid confusion:
//
//   - LedgerService.creditPredictionWin()  — dead code, settlement uses PointsLedgerService
//
// Keep these (they ARE still used):
//   - LedgerService.credit()               — used by TokenAllowanceService
//   - LedgerService.debit()                — used by TokenAllowanceService.consumeTokens
//   - LedgerService.createSignupBonus()    — used by AuthService.register
//   - LedgerService.refundPrediction()     — used by EventService.cancel
//   - LedgerService.stakeForPrediction()   — exists but consumeTokens handles staking now
//     ^ This one is also potentially dead — verify if anything calls it directly.


// =============================================================================
// BONUS FIX 2: Add points metrics to /admin/stats
// =============================================================================
// Replace the stats handler in src/routes/admin.ts with this:

router.get(
  '/stats',
  async (req, res, next) => {
    try {
      const [
        userCount,
        eventCount,
        predictionCount,
        redemptionCount,
        totalTokensInCirculation,
        totalPointsInCirculation,
        totalPointsPaidOut,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.event.count(),
        prisma.prediction.count(),
        prisma.redemption.count(),
        prisma.user.aggregate({ _sum: { tokenBalance: true } }),
        prisma.user.aggregate({ _sum: { pointsBalance: true } }),
        prisma.pointsTransaction.aggregate({
          where: { amount: { gt: 0 } },
          _sum: { amount: true },
        }),
      ]);

      const pendingRedemptions = await prisma.redemption.count({
        where: { status: 'PENDING' },
      });

      const openEvents = await prisma.event.count({
        where: { status: 'OPEN' },
      });

      const settledEvents = await prisma.event.count({
        where: { status: 'SETTLED' },
      });

      sendSuccess(res, {
        stats: {
          users: userCount,
          events: {
            total: eventCount,
            open: openEvents,
            settled: settledEvents,
          },
          predictions: predictionCount,
          redemptions: {
            total: redemptionCount,
            pending: pendingRedemptions,
          },
          tokens: {
            inCirculation: totalTokensInCirculation._sum.tokenBalance ?? 0,
          },
          points: {
            inCirculation: totalPointsInCirculation._sum.pointsBalance ?? 0,
            totalPaidOut: totalPointsPaidOut._sum.amount ?? 0,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);


// =============================================================================
// BONUS FIX 3: TokenAllowance.consumeTokens — fix tokensRemaining accuracy
// =============================================================================
// In src/services/tokenAllowance.ts, the consumeTokens method sets:
//   tokensRemaining: result.newBalance
//
// But result.newBalance is the TOTAL token balance (from the ledger), not the
// remaining daily allowance. Fix by calculating remaining allowance properly:

// In the consumeTokens method, replace:
//   await upsertAllowance(client, userId, {
//     tokensRemaining: result.newBalance,
//     lastResetDate: status.lastResetDate,
//   });
//
// With:
//   await upsertAllowance(client, userId, {
//     tokensRemaining: Math.max(0, status.tokensRemaining - amount),
//     lastResetDate: status.lastResetDate,
//   });
