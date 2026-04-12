import { Router } from 'express';
import { sendSuccess } from '../utils/index.js';
import authRoutes from './auth.js';
import eventRoutes from './events.js';
import predictionRoutes from './predictions.js';
import rewardRoutes from './rewards.js';
import tokenRoutes from './tokens.js';
import pointsRoutes from './points.js';
import leaderboardRoutes from './leaderboard.js';
import achievementsRoutes from './achievements.js';
import adminRoutes from './admin.js';
import healthRoutes from './health.js';
import leagueRoutes from './leagues.js';
import accumulatorRoutes from './accumulators.js';

const router = Router();

router.get('/', (_req, res) => {
  sendSuccess(res, {
    name: 'Prediction Platform API',
    version: '1.0.0',
    status: 'running',
    health: '/api/v1/health',
    live: '/api/v1/health/live',
  });
});

// API Routes
router.use('/auth', authRoutes);
router.use('/events', eventRoutes);
router.use('/predictions', predictionRoutes);
router.use('/rewards', rewardRoutes);
router.use('/tokens', tokenRoutes);
router.use('/points', pointsRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/achievements', achievementsRoutes);
router.use('/admin', adminRoutes);
router.use('/health', healthRoutes);
router.use('/leagues', leagueRoutes);
router.use('/accumulators', accumulatorRoutes);

export default router;
