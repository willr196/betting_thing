import { randomInt, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { config } from '../config/index.js';
import { AppError } from '../utils/index.js';
import { getISOWeekKey } from '../utils/week.js';
import { prisma } from './database.js';
import { LeagueStandingsService } from './leagueStandings.js';

type LeaguePeriod = 'WEEKLY' | 'ALL_TIME';

type LeagueRow = {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  inviteCode: string;
  isOpen: boolean;
  maxMembers: number;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
};

type MembershipRow = {
  role: 'OWNER' | 'MEMBER';
  joinedAt: Date;
};

type CountRow = { count: number };

const INVITE_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 8;
const MAX_INVITE_CODE_RETRIES = 5;
const MAX_OWNED_LEAGUES = 5;
const MAX_ACTIVE_LEAGUE_MEMBERSHIPS = 20;

function normalizeInviteCode(inviteCode: string): string {
  return inviteCode.toUpperCase().trim();
}

function isValidInviteCode(inviteCode: string): boolean {
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(inviteCode);
}

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_CHARSET[randomInt(0, INVITE_CODE_CHARSET.length)];
  }
  return code;
}

function anonymizeEmail(email: string): string {
  const localPart = email.split('@')[0] ?? email;
  return `${localPart.slice(0, 3)}***`;
}

function coercePeriodKey(period: LeaguePeriod, periodKey?: string): string {
  if (period === 'ALL_TIME') {
    return 'all-time';
  }
  return periodKey ?? getISOWeekKey();
}

function parsePeriod(input: 'weekly' | 'all-time'): LeaguePeriod {
  return input === 'all-time' ? 'ALL_TIME' : 'WEEKLY';
}

function ensureWeekKeyFormat(period: LeaguePeriod, periodKey: string): void {
  if (period === 'WEEKLY' && !/^\d{4}-W\d{2}$/.test(periodKey)) {
    throw AppError.badRequest('periodKey must be in ISO week format: YYYY-WNN');
  }
}

function buildInviteUrl(inviteCode: string): string {
  const baseUrl = config.server.frontendUrl ?? 'http://localhost:5173';
  return `${baseUrl.replace(/\/+$/, '')}/leagues/join?code=${inviteCode}`;
}

async function countActiveMembershipsByUser(userId: string): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<CountRow>>`
    SELECT COUNT(*)::int AS "count"
    FROM "LeagueMembership"
    WHERE "userId" = ${userId} AND "isActive" = true
  `;
  return row?.count ?? 0;
}

async function countOwnedLeagues(userId: string): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<CountRow>>`
    SELECT COUNT(*)::int AS "count"
    FROM "League"
    WHERE "ownerId" = ${userId}
  `;
  return row?.count ?? 0;
}

async function lockLeagueByInviteCode(
  tx: Prisma.TransactionClient,
  inviteCode: string
): Promise<Pick<LeagueRow, 'id' | 'isOpen' | 'maxMembers'> | null> {
  const [league] = await tx.$queryRaw<
    Array<Pick<LeagueRow, 'id' | 'isOpen' | 'maxMembers'>>
  >`
    SELECT "id", "isOpen", "maxMembers"
    FROM "League"
    WHERE "inviteCode" = ${inviteCode}
    FOR UPDATE
  `;
  return league ?? null;
}

async function lockLeagueById(
  tx: Prisma.TransactionClient,
  leagueId: string
): Promise<LeagueRow | null> {
  const [league] = await tx.$queryRaw<Array<LeagueRow>>`
    SELECT
      "id",
      "name",
      "description",
      "emoji",
      "inviteCode",
      "isOpen",
      "maxMembers",
      "ownerId",
      "createdAt",
      "updatedAt"
    FROM "League"
    WHERE "id" = ${leagueId}
    FOR UPDATE
  `;
  return league ?? null;
}

async function generateUniqueInviteCode(
  tx: Prisma.TransactionClient,
  attempts = MAX_INVITE_CODE_RETRIES
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const code = generateInviteCode();
    const [existing] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "League"
      WHERE "inviteCode" = ${code}
      LIMIT 1
    `;
    if (!existing) {
      return code;
    }
  }
  throw AppError.internal('Failed to generate a unique invite code');
}

async function assertActiveMembership(leagueId: string, userId: string): Promise<void> {
  const [membership] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "LeagueMembership"
    WHERE "leagueId" = ${leagueId} AND "userId" = ${userId} AND "isActive" = true
    LIMIT 1
  `;

  if (!membership) {
    throw AppError.forbidden('You are not a member of this league');
  }
}

export const LeagueService = {
  parsePeriod,

  async create(
    userId: string,
    data: { name: string; description?: string; emoji?: string }
  ) {
    const [ownedCount, activeMembershipCount] = await Promise.all([
      countOwnedLeagues(userId),
      countActiveMembershipsByUser(userId),
    ]);

    if (ownedCount >= MAX_OWNED_LEAGUES) {
      throw AppError.conflict(`You can own at most ${MAX_OWNED_LEAGUES} leagues`);
    }

    if (activeMembershipCount >= MAX_ACTIVE_LEAGUE_MEMBERSHIPS) {
      throw AppError.conflict(
        `You can be an active member of at most ${MAX_ACTIVE_LEAGUE_MEMBERSHIPS} leagues`
      );
    }

    const leagueId = await prisma.$transaction(async (tx) => {
      const inviteCode = await generateUniqueInviteCode(tx);
      const id = randomUUID();

      await tx.$executeRaw`
        INSERT INTO "League" (
          "id", "name", "description", "inviteCode", "isOpen", "maxMembers", "emoji", "ownerId", "createdAt", "updatedAt"
        )
        VALUES (
          ${id}, ${data.name}, ${data.description ?? null}, ${inviteCode}, true, 50, ${data.emoji ?? '⚽'}, ${userId}, NOW(), NOW()
        )
      `;

      await tx.$executeRaw`
        INSERT INTO "LeagueMembership" (
          "id", "leagueId", "userId", "role", "joinedAt", "leftAt", "isActive"
        )
        VALUES (
          ${randomUUID()}, ${id}, ${userId}, 'OWNER'::"LeagueRole", NOW(), NULL, true
        )
      `;

      return id;
    });

    await LeagueStandingsService.recalculateLeague(leagueId);
    return this.getById(leagueId, userId);
  },

  async join(userId: string, rawInviteCode: string) {
    const inviteCode = normalizeInviteCode(rawInviteCode);
    if (!isValidInviteCode(inviteCode)) {
      throw AppError.badRequest('Invalid invite code');
    }

    const { leagueId } = await prisma.$transaction(async (tx) => {
      const league = await lockLeagueByInviteCode(tx, inviteCode);
      if (!league) {
        throw AppError.notFound('League');
      }
      if (!league.isOpen) {
        throw AppError.conflict('League is closed to new members');
      }

      const [activeMembershipsRow, activeLeagueMembersRow, existingMembership] = await Promise.all([
        tx.$queryRaw<Array<CountRow>>`
          SELECT COUNT(*)::int AS "count"
          FROM "LeagueMembership"
          WHERE "userId" = ${userId} AND "isActive" = true
        `,
        tx.$queryRaw<Array<CountRow>>`
          SELECT COUNT(*)::int AS "count"
          FROM "LeagueMembership"
          WHERE "leagueId" = ${league.id} AND "isActive" = true
        `,
        tx.$queryRaw<Array<{ id: string; isActive: boolean }>>`
          SELECT "id", "isActive"
          FROM "LeagueMembership"
          WHERE "leagueId" = ${league.id} AND "userId" = ${userId}
          LIMIT 1
        `,
      ]);

      const activeMembershipCount = activeMembershipsRow[0]?.count ?? 0;
      const activeLeagueMembers = activeLeagueMembersRow[0]?.count ?? 0;
      const membershipRow = existingMembership[0];

      if (membershipRow?.isActive) {
        throw AppError.conflict('You are already a member of this league');
      }

      if (activeMembershipCount >= MAX_ACTIVE_LEAGUE_MEMBERSHIPS) {
        throw AppError.conflict(
          `You can be an active member of at most ${MAX_ACTIVE_LEAGUE_MEMBERSHIPS} leagues`
        );
      }

      if (activeLeagueMembers >= league.maxMembers) {
        throw AppError.conflict('League is full');
      }

      if (membershipRow) {
        await tx.$executeRaw`
          UPDATE "LeagueMembership"
          SET "isActive" = true, "leftAt" = NULL, "joinedAt" = NOW(), "role" = 'MEMBER'::"LeagueRole"
          WHERE "id" = ${membershipRow.id}
        `;
      } else {
        await tx.$executeRaw`
          INSERT INTO "LeagueMembership" (
            "id", "leagueId", "userId", "role", "joinedAt", "leftAt", "isActive"
          )
          VALUES (
            ${randomUUID()}, ${league.id}, ${userId}, 'MEMBER'::"LeagueRole", NOW(), NULL, true
          )
        `;
      }

      return { leagueId: league.id };
    });

    await LeagueStandingsService.recalculateLeague(leagueId);
    return this.getById(leagueId, userId);
  },

  async leave(userId: string, leagueId: string) {
    await prisma.$transaction(async (tx) => {
      const [membership] = await tx.$queryRaw<
        Array<{ id: string; role: 'OWNER' | 'MEMBER'; isActive: boolean }>
      >`
        SELECT "id", "role", "isActive"
        FROM "LeagueMembership"
        WHERE "leagueId" = ${leagueId} AND "userId" = ${userId}
        LIMIT 1
      `;

      if (!membership || !membership.isActive) {
        throw AppError.forbidden('You are not an active member of this league');
      }

      if (membership.role === 'OWNER') {
        throw AppError.conflict('Owner must transfer ownership or delete the league');
      }

      await tx.$executeRaw`
        UPDATE "LeagueMembership"
        SET "isActive" = false, "leftAt" = NOW()
        WHERE "id" = ${membership.id}
      `;
    });

    await LeagueStandingsService.recalculateLeague(leagueId);
    return { left: true };
  },

  async delete(userId: string, leagueId: string) {
    const [league] = await prisma.$queryRaw<Array<{ ownerId: string }>>`
      SELECT "ownerId"
      FROM "League"
      WHERE "id" = ${leagueId}
      LIMIT 1
    `;

    if (!league) {
      throw AppError.notFound('League');
    }

    if (league.ownerId !== userId) {
      throw AppError.forbidden('Only the owner can delete this league');
    }

    await prisma.$executeRaw`
      DELETE FROM "League"
      WHERE "id" = ${leagueId}
    `;

    return { deleted: true };
  },

  async transferOwnership(userId: string, leagueId: string, newOwnerId: string) {
    if (userId === newOwnerId) {
      throw AppError.badRequest('New owner must be a different member');
    }

    await prisma.$transaction(async (tx) => {
      const league = await lockLeagueById(tx, leagueId);
      if (!league) {
        throw AppError.notFound('League');
      }
      if (league.ownerId !== userId) {
        throw AppError.forbidden('Only the owner can transfer ownership');
      }

      const [newOwnerMembership] = await tx.$queryRaw<
        Array<{ id: string; isActive: boolean }>
      >`
        SELECT "id", "isActive"
        FROM "LeagueMembership"
        WHERE "leagueId" = ${leagueId} AND "userId" = ${newOwnerId}
        LIMIT 1
      `;

      if (!newOwnerMembership || !newOwnerMembership.isActive) {
        throw AppError.badRequest('New owner must be an active league member');
      }

      await tx.$executeRaw`
        UPDATE "League"
        SET "ownerId" = ${newOwnerId}, "updatedAt" = NOW()
        WHERE "id" = ${leagueId}
      `;

      await tx.$executeRaw`
        UPDATE "LeagueMembership"
        SET "role" = 'OWNER'::"LeagueRole"
        WHERE "id" = ${newOwnerMembership.id}
      `;

      await tx.$executeRaw`
        UPDATE "LeagueMembership"
        SET "role" = 'MEMBER'::"LeagueRole"
        WHERE "leagueId" = ${leagueId} AND "userId" = ${userId}
      `;
    });

    return this.getById(leagueId, userId);
  },

  async update(
    userId: string,
    leagueId: string,
    data: { name?: string; description?: string; emoji?: string; isOpen?: boolean }
  ) {
    const [league] = await prisma.$queryRaw<Array<{ ownerId: string }>>`
      SELECT "ownerId"
      FROM "League"
      WHERE "id" = ${leagueId}
      LIMIT 1
    `;

    if (!league) {
      throw AppError.notFound('League');
    }
    if (league.ownerId !== userId) {
      throw AppError.forbidden('Only the owner can update this league');
    }

    const updates: Prisma.Sql[] = [];
    if (data.name !== undefined) updates.push(Prisma.sql`"name" = ${data.name}`);
    if (data.description !== undefined) updates.push(Prisma.sql`"description" = ${data.description}`);
    if (data.emoji !== undefined) updates.push(Prisma.sql`"emoji" = ${data.emoji}`);
    if (data.isOpen !== undefined) updates.push(Prisma.sql`"isOpen" = ${data.isOpen}`);

    if (updates.length > 0) {
      await prisma.$executeRaw(
        Prisma.sql`
          UPDATE "League"
          SET ${Prisma.join([...updates, Prisma.sql`"updatedAt" = NOW()`], ', ')}
          WHERE "id" = ${leagueId}
        `
      );
    }

    return this.getById(leagueId, userId);
  },

  async kickMember(userId: string, leagueId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw AppError.badRequest('Use leave league instead of kicking yourself');
    }

    await prisma.$transaction(async (tx) => {
      const league = await lockLeagueById(tx, leagueId);
      if (!league) {
        throw AppError.notFound('League');
      }
      if (league.ownerId !== userId) {
        throw AppError.forbidden('Only the owner can kick members');
      }

      const [targetMembership] = await tx.$queryRaw<
        Array<{ id: string; role: 'OWNER' | 'MEMBER'; isActive: boolean }>
      >`
        SELECT "id", "role", "isActive"
        FROM "LeagueMembership"
        WHERE "leagueId" = ${leagueId} AND "userId" = ${targetUserId}
        LIMIT 1
      `;

      if (!targetMembership || !targetMembership.isActive) {
        throw AppError.notFound('League membership');
      }
      if (targetMembership.role === 'OWNER') {
        throw AppError.badRequest('Cannot kick the league owner');
      }

      await tx.$executeRaw`
        UPDATE "LeagueMembership"
        SET "isActive" = false, "leftAt" = NOW()
        WHERE "id" = ${targetMembership.id}
      `;
    });

    await LeagueStandingsService.recalculateLeague(leagueId);
    return { removed: true };
  },

  async regenerateInviteCode(userId: string, leagueId: string) {
    const inviteCode = await prisma.$transaction(async (tx) => {
      const league = await lockLeagueById(tx, leagueId);
      if (!league) {
        throw AppError.notFound('League');
      }
      if (league.ownerId !== userId) {
        throw AppError.forbidden('Only the owner can regenerate invite codes');
      }

      const nextInviteCode = await generateUniqueInviteCode(tx);
      await tx.$executeRaw`
        UPDATE "League"
        SET "inviteCode" = ${nextInviteCode}, "updatedAt" = NOW()
        WHERE "id" = ${leagueId}
      `;

      return nextInviteCode;
    });

    return {
      inviteCode,
      inviteUrl: buildInviteUrl(inviteCode),
    };
  },

  async getById(leagueId: string, userId: string) {
    await assertActiveMembership(leagueId, userId);

    const [league, memberCountRow, membership] = await Promise.all([
      prisma.$queryRaw<Array<LeagueRow>>`
        SELECT
          "id",
          "name",
          "description",
          "emoji",
          "inviteCode",
          "isOpen",
          "maxMembers",
          "ownerId",
          "createdAt",
          "updatedAt"
        FROM "League"
        WHERE "id" = ${leagueId}
        LIMIT 1
      `,
      prisma.$queryRaw<Array<CountRow>>`
        SELECT COUNT(*)::int AS "count"
        FROM "LeagueMembership"
        WHERE "leagueId" = ${leagueId} AND "isActive" = true
      `,
      prisma.$queryRaw<Array<MembershipRow>>`
        SELECT "role", "joinedAt"
        FROM "LeagueMembership"
        WHERE "leagueId" = ${leagueId} AND "userId" = ${userId}
        LIMIT 1
      `,
    ]);

    if (!league[0]) {
      throw AppError.notFound('League');
    }

    return {
      league: league[0],
      membership: membership[0] ?? null,
      memberCount: memberCountRow[0]?.count ?? 0,
    };
  },

  async getMyLeagues(userId: string) {
    const weekKey = getISOWeekKey();

    const memberships = await prisma.$queryRaw<
      Array<{
        joinedAt: Date;
        role: 'OWNER' | 'MEMBER';
        id: string;
        name: string;
        description: string | null;
        emoji: string;
        inviteCode: string;
        isOpen: boolean;
        maxMembers: number;
        ownerId: string;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      SELECT
        lm."joinedAt",
        lm."role",
        l."id",
        l."name",
        l."description",
        l."emoji",
        l."inviteCode",
        l."isOpen",
        l."maxMembers",
        l."ownerId",
        l."createdAt",
        l."updatedAt"
      FROM "LeagueMembership" lm
      INNER JOIN "League" l ON l."id" = lm."leagueId"
      WHERE lm."userId" = ${userId} AND lm."isActive" = true
      ORDER BY lm."joinedAt" DESC
    `;

    if (memberships.length === 0) {
      return { leagues: [] as Array<unknown> };
    }

    const leagueIds = memberships.map((membership) => membership.id);

    const [weeklyRows, memberCounts] = await Promise.all([
      prisma.$queryRaw<
        Array<{ leagueId: string; rank: number; pointsEarned: number; totalPredictions: number }>
      >`
        SELECT "leagueId", "rank", "pointsEarned", "totalPredictions"
        FROM "LeagueStanding"
        WHERE
          "userId" = ${userId}
          AND "period" = 'WEEKLY'::"LeaguePeriod"
          AND "periodKey" = ${weekKey}
          AND "leagueId" IN (${Prisma.join(leagueIds)})
      `,
      prisma.$queryRaw<Array<{ leagueId: string; count: number }>>`
        SELECT "leagueId", COUNT(*)::int AS "count"
        FROM "LeagueMembership"
        WHERE "isActive" = true AND "leagueId" IN (${Prisma.join(leagueIds)})
        GROUP BY "leagueId"
      `,
    ]);

    const weeklyMap = new Map(
      weeklyRows.map((row) => [row.leagueId, row] as const)
    );
    const memberCountMap = new Map(
      memberCounts.map((row) => [row.leagueId, row.count] as const)
    );

    return {
      leagues: memberships.map((membership) => ({
        id: membership.id,
        name: membership.name,
        description: membership.description,
        emoji: membership.emoji,
        inviteCode: membership.inviteCode,
        isOpen: membership.isOpen,
        maxMembers: membership.maxMembers,
        ownerId: membership.ownerId,
        createdAt: membership.createdAt,
        updatedAt: membership.updatedAt,
        role: membership.role,
        joinedAt: membership.joinedAt,
        memberCount: memberCountMap.get(membership.id) ?? 0,
        weekly: weeklyMap.get(membership.id) ?? null,
      })),
    };
  },

  async getMembers(leagueId: string, userId: string) {
    await assertActiveMembership(leagueId, userId);

    const members = await prisma.$queryRaw<
      Array<{ userId: string; role: 'OWNER' | 'MEMBER'; joinedAt: Date; email: string }>
    >`
      SELECT
        lm."userId",
        lm."role",
        lm."joinedAt",
        u."email"
      FROM "LeagueMembership" lm
      INNER JOIN "User" u ON u."id" = lm."userId"
      WHERE lm."leagueId" = ${leagueId} AND lm."isActive" = true
      ORDER BY lm."role" ASC, lm."joinedAt" ASC
    `;

    return {
      members: members.map((member) => ({
        userId: member.userId,
        displayName: anonymizeEmail(member.email),
        role: member.role,
        joinedAt: member.joinedAt,
      })),
    };
  },

  async getStandings(
    leagueId: string,
    userId: string,
    period: LeaguePeriod,
    periodKey?: string
  ) {
    await assertActiveMembership(leagueId, userId);

    const resolvedPeriodKey = coercePeriodKey(period, periodKey);
    ensureWeekKeyFormat(period, resolvedPeriodKey);

    const rows = await prisma.$queryRaw<
      Array<{
        rank: number;
        userId: string;
        pointsEarned: number;
        predictionsWon: number;
        predictionsLost: number;
        totalPredictions: number;
        updatedAt: Date;
        email: string;
      }>
    >`
      SELECT
        ls."rank",
        ls."userId",
        ls."pointsEarned",
        ls."predictionsWon",
        ls."predictionsLost",
        ls."totalPredictions",
        ls."updatedAt",
        u."email"
      FROM "LeagueStanding" ls
      INNER JOIN "User" u ON u."id" = ls."userId"
      WHERE
        ls."leagueId" = ${leagueId}
        AND ls."period" = ${period}::"LeaguePeriod"
        AND ls."periodKey" = ${resolvedPeriodKey}
      ORDER BY ls."rank" ASC
    `;

    const standings = rows.map((row) => ({
      rank: row.rank,
      userId: row.userId,
      displayName: anonymizeEmail(row.email),
      pointsEarned: row.pointsEarned,
      predictionsWon: row.predictionsWon,
      predictionsLost: row.predictionsLost,
      totalPredictions: row.totalPredictions,
      winRate:
        row.totalPredictions > 0
          ? Number((row.predictionsWon / row.totalPredictions).toFixed(4))
          : 0,
      updatedAt: row.updatedAt,
    }));

    const requester = standings.find((row) => row.userId === userId) ?? null;
    const updatedAt = rows.reduce<Date | null>((latest, row) => {
      if (!latest || row.updatedAt.getTime() > latest.getTime()) {
        return row.updatedAt;
      }
      return latest;
    }, null);

    return {
      leagueId,
      period,
      periodKey: resolvedPeriodKey,
      standings,
      requester,
      updatedAt,
    };
  },

  async getInviteLink(leagueId: string, userId: string) {
    await assertActiveMembership(leagueId, userId);

    const [league] = await prisma.$queryRaw<Array<{ inviteCode: string }>>`
      SELECT "inviteCode"
      FROM "League"
      WHERE "id" = ${leagueId}
      LIMIT 1
    `;

    if (!league) {
      throw AppError.notFound('League');
    }

    return {
      inviteCode: league.inviteCode,
      inviteUrl: buildInviteUrl(league.inviteCode),
    };
  },
};
