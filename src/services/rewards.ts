import { RedemptionStatus, Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { PointsLedgerService } from './pointsLedger.js';
import { AppError } from '../utils/index.js';

// =============================================================================
// REWARDS SERVICE
// =============================================================================

export const RewardsService = {
  // ===========================================================================
  // REWARDS MANAGEMENT (Admin)
  // ===========================================================================

  /**
   * Create a new reward.
   */
  async createReward(data: {
    name: string;
    description?: string;
    pointsCost: number;
    stockLimit?: number;
    imageUrl?: string;
  }) {
    if (data.pointsCost <= 0) {
      throw AppError.badRequest('Points cost must be positive');
    }

    return prisma.reward.create({
      data: {
        name: data.name,
        description: data.description,
        pointsCost: data.pointsCost,
        stockLimit: data.stockLimit,
        imageUrl: data.imageUrl,
        isActive: true,
      },
    });
  },

  /**
   * Update a reward.
   */
  async updateReward(
    rewardId: string,
    data: {
      name?: string;
      description?: string;
      pointsCost?: number;
      stockLimit?: number;
      imageUrl?: string;
      isActive?: boolean;
    }
  ) {
    const reward = await prisma.reward.findUnique({
      where: { id: rewardId },
    });

    if (!reward) {
      throw AppError.notFound('Reward');
    }

    if (data.pointsCost !== undefined && data.pointsCost <= 0) {
      throw AppError.badRequest('Points cost must be positive');
    }

    return prisma.reward.update({
      where: { id: rewardId },
      data,
    });
  },

  /**
   * Get reward by ID.
   */
  async getRewardById(rewardId: string) {
    const reward = await prisma.reward.findUnique({
      where: { id: rewardId },
    });

    if (!reward) {
      throw AppError.notFound('Reward');
    }

    return reward;
  },

  /**
   * List all rewards.
   */
  async listRewards(options: {
    activeOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}) {
    const { activeOnly = true, limit = 50, offset = 0 } = options;

    const where: Prisma.RewardWhereInput = {};
    
    if (activeOnly) {
      where.isActive = true;
    }

    const [rewards, total] = await Promise.all([
      prisma.reward.findMany({
        where,
        orderBy: { pointsCost: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.reward.count({ where }),
    ]);

    return { rewards, total };
  },

  // ===========================================================================
  // REDEMPTIONS
  // ===========================================================================

  /**
   * Redeem a reward.
   * Atomically:
   * 1. Check reward is available
   * 2. Check user has enough tokens
   * 3. Debit tokens
   * 4. Create redemption record
   * 5. Increment stock claimed (if limited)
   */
  async redeem(userId: string, rewardId: string) {
    // Execute redemption atomically with all checks inside the transaction
    const redemption = await prisma.$transaction(async (tx) => {
      // Lock the reward row to prevent stock oversell
      const [reward] = await tx.$queryRaw<
        Array<{ id: string; name: string; pointsCost: number; stockLimit: number | null; stockClaimed: number; isActive: boolean }>
      >`SELECT "id", "name", "pointsCost", "stockLimit", "stockClaimed", "isActive" FROM "Reward" WHERE "id" = ${rewardId} FOR UPDATE`;

      if (!reward) {
        throw AppError.notFound('Reward');
      }

      if (!reward.isActive) {
        throw new AppError('REWARD_UNAVAILABLE', 'This reward is not available', 400);
      }

      if (reward.stockLimit !== null && reward.stockClaimed >= reward.stockLimit) {
        throw new AppError('REWARD_OUT_OF_STOCK', 'This reward is out of stock', 400);
      }

      // Create redemption record
      const newRedemption = await tx.redemption.create({
        data: {
          userId,
          rewardId,
          pointsCost: reward.pointsCost,
          status: 'PENDING',
        },
      });

      await PointsLedgerService.debit(
        {
          userId,
          amount: reward.pointsCost,
          type: 'REDEMPTION',
          referenceType: 'REDEMPTION',
          referenceId: newRedemption.id,
          description: `Redemption ${newRedemption.id}`,
        },
        tx
      );

      // Increment stock claimed if limited
      if (reward.stockLimit !== null) {
        await tx.reward.update({
          where: { id: rewardId },
          data: { stockClaimed: { increment: 1 } },
        });
      }

      // Return with reward details
      return tx.redemption.findUniqueOrThrow({
        where: { id: newRedemption.id },
        include: { reward: true },
      });
    });

    return redemption;
  },

  /**
   * Get redemption by ID.
   */
  async getRedemptionById(redemptionId: string, userId?: string) {
    const redemption = await prisma.redemption.findUnique({
      where: { id: redemptionId },
      include: { reward: true },
    });

    if (!redemption) {
      throw AppError.notFound('Redemption');
    }

    // If userId provided, verify ownership
    if (userId && redemption.userId !== userId) {
      throw AppError.forbidden('You can only view your own redemptions');
    }

    return redemption;
  },

  /**
   * Get user's redemptions.
   */
  async getUserRedemptions(
    userId: string,
    options: {
      status?: RedemptionStatus;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const { status, limit = 20, offset = 0 } = options;

    const where: Prisma.RedemptionWhereInput = { userId };
    
    if (status) {
      where.status = status;
    }

    const [redemptions, total] = await Promise.all([
      prisma.redemption.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { reward: true },
      }),
      prisma.redemption.count({ where }),
    ]);

    return { redemptions, total };
  },

  /**
   * List all redemptions (admin).
   */
  async listRedemptions(options: {
    status?: RedemptionStatus;
    limit?: number;
    offset?: number;
  } = {}) {
    const { status, limit = 50, offset = 0 } = options;

    const where: Prisma.RedemptionWhereInput = {};
    
    if (status) {
      where.status = status;
    }

    const [redemptions, total] = await Promise.all([
      prisma.redemption.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          reward: true,
          user: {
            select: { id: true, email: true },
          },
        },
      }),
      prisma.redemption.count({ where }),
    ]);

    return { redemptions, total };
  },

  /**
   * Fulfil a redemption (admin).
   */
  async fulfil(
    redemptionId: string,
    fulfilledBy: string,
    fulfilmentNote?: string
  ) {
    const redemption = await prisma.redemption.findUnique({
      where: { id: redemptionId },
    });

    if (!redemption) {
      throw AppError.notFound('Redemption');
    }

    if (redemption.status !== 'PENDING') {
      throw new AppError(
        'CONFLICT',
        `Redemption is ${redemption.status}, cannot fulfil`,
        409
      );
    }

    return prisma.redemption.update({
      where: { id: redemptionId },
      data: {
        status: 'FULFILLED',
        fulfilledBy,
        fulfilledAt: new Date(),
        fulfilmentNote,
      },
      include: { reward: true },
    });
  },

  /**
   * Cancel a redemption and refund tokens (admin).
   */
  async cancel(redemptionId: string, cancelledBy: string) {
    const redemption = await prisma.redemption.findUnique({
      where: { id: redemptionId },
      include: { reward: true },
    });

    if (!redemption) {
      throw AppError.notFound('Redemption');
    }

    if (redemption.status !== 'PENDING') {
      throw new AppError(
        'CONFLICT',
        `Redemption is ${redemption.status}, cannot cancel`,
        409
      );
    }

    // Cancel and refund atomically
    await prisma.$transaction(async (tx) => {
      await PointsLedgerService.credit(
        {
          userId: redemption.userId,
          amount: redemption.pointsCost,
          type: 'REDEMPTION_REFUND',
          referenceType: 'REDEMPTION',
          referenceId: redemptionId,
          description: `Refund for cancelled redemption ${redemptionId}`,
        },
        tx
      );

      // Update redemption status
      await tx.redemption.update({
        where: { id: redemptionId },
        data: {
          status: 'CANCELLED',
          fulfilledBy: cancelledBy,
          fulfilledAt: new Date(),
          fulfilmentNote: 'Cancelled and refunded',
        },
      });

      // Decrement stock claimed if limited
      if (redemption.reward.stockLimit !== null) {
        await tx.reward.update({
          where: { id: redemption.rewardId },
          data: { stockClaimed: { decrement: 1 } },
        });
      }
    });

    return this.getRedemptionById(redemptionId);
  },
};
