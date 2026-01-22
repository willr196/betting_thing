import { Router } from 'express';
import authRoutes from './auth.js';
import eventRoutes from './events.js';
import predictionRoutes from './predictions.js';
import rewardRoutes from './rewards.js';
import tokenRoutes from './tokens.js';
import pointsRoutes from './points.js';
import adminRoutes from './admin.js';
import healthRoutes from './health.js';

const router = Router();

// API Routes
router.use('/auth', authRoutes);
router.use('/events', eventRoutes);
router.use('/predictions', predictionRoutes);
router.use('/rewards', rewardRoutes);
router.use('/tokens', tokenRoutes);
router.use('/points', pointsRoutes);
router.use('/admin', adminRoutes);
router.use('/health', healthRoutes);

export default router;
