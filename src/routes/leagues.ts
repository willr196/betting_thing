import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, validateBody, validateParams, validateQuery, getAuthUser, idParamSchema } from '../middleware/index.js';
import { LeagueService } from '../services/leagues.js';
import { asyncHandler, sendSuccess } from '../utils/index.js';

const router = Router();

router.use(requireAuth);

const createLeagueSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(200).optional(),
  emoji: z.string().max(4).optional(),
});

const joinLeagueSchema = z.object({
  inviteCode: z
    .string()
    .transform((value) => value.toUpperCase().trim())
    .refine((value) => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(value), 'Invalid invite code'),
});

const updateLeagueSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  description: z.string().max(200).optional(),
  emoji: z.string().max(4).optional(),
  isOpen: z.boolean().optional(),
});

const standingsQuerySchema = z.object({
  period: z.enum(['weekly', 'all-time']).default('weekly'),
  periodKey: z.string().min(1).optional(),
});

const userTargetSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
});

router.post(
  '/',
  validateBody(createLeagueSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const league = await LeagueService.create(userId, req.body as z.infer<typeof createLeagueSchema>);
    sendSuccess(res, league, 201);
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const leagues = await LeagueService.getMyLeagues(userId);
    sendSuccess(res, leagues);
  })
);

router.post(
  '/join',
  validateBody(joinLeagueSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { inviteCode } = req.body as z.infer<typeof joinLeagueSchema>;
    const league = await LeagueService.join(userId, inviteCode);
    sendSuccess(res, league, 201);
  })
);

router.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const league = await LeagueService.getById(req.params.id as string, userId);
    sendSuccess(res, league);
  })
);

router.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateLeagueSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const league = await LeagueService.update(
      userId,
      req.params.id as string,
      req.body as z.infer<typeof updateLeagueSchema>
    );
    sendSuccess(res, league);
  })
);

router.delete(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const result = await LeagueService.delete(userId, req.params.id as string);
    sendSuccess(res, result);
  })
);

router.post(
  '/:id/leave',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const result = await LeagueService.leave(userId, req.params.id as string);
    sendSuccess(res, result);
  })
);

router.post(
  '/:id/kick/:userId',
  validateParams(userTargetSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const result = await LeagueService.kickMember(
      userId,
      req.params.id as string,
      req.params.userId as string
    );
    sendSuccess(res, result);
  })
);

router.post(
  '/:id/transfer/:userId',
  validateParams(userTargetSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const league = await LeagueService.transferOwnership(
      userId,
      req.params.id as string,
      req.params.userId as string
    );
    sendSuccess(res, league);
  })
);

router.post(
  '/:id/regenerate-code',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const invite = await LeagueService.regenerateInviteCode(userId, req.params.id as string);
    sendSuccess(res, invite);
  })
);

router.get(
  '/:id/members',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const members = await LeagueService.getMembers(req.params.id as string, userId);
    sendSuccess(res, members);
  })
);

router.get(
  '/:id/standings',
  validateParams(idParamSchema),
  validateQuery(standingsQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { period, periodKey } = req.query as unknown as z.infer<typeof standingsQuerySchema>;
    const standings = await LeagueService.getStandings(
      req.params.id as string,
      userId,
      LeagueService.parsePeriod(period),
      periodKey
    );
    sendSuccess(res, standings);
  })
);

router.get(
  '/:id/invite',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const invite = await LeagueService.getInviteLink(req.params.id as string, userId);
    sendSuccess(res, invite);
  })
);

export default router;

