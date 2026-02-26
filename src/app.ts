import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { config } from './config/index.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/index.js';
import { logger } from './logger.js';

// =============================================================================
// EXPRESS APP CONFIGURATION
// =============================================================================

const app = express();

// -----------------------------------------------------------------------------
// Security Middleware
// -----------------------------------------------------------------------------

if (config.server.trustProxy !== undefined) {
  app.set('trust proxy', config.server.trustProxy);
}

// Helmet sets various HTTP headers for security
app.use(helmet());

// CORS configuration
// In development, default to reflecting the request origin so docker/ngrok/browser
// setups don't require manual allow-listing.
const corsOrigin = config.isDev
  ? (config.server.frontendUrl ?? true)
  : (config.server.frontendUrl ?? false);

app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMinutes * 60 * 1000,
  max: config.rateLimit.max,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// -----------------------------------------------------------------------------
// Body Parsing & Cookies
// -----------------------------------------------------------------------------

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// -----------------------------------------------------------------------------
// Request Correlation ID + Logging
// -----------------------------------------------------------------------------

app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
  res.setHeader('x-request-id', requestId);
  (req as express.Request & { requestId: string }).requestId = requestId;

  logger.info(
    { requestId, method: req.method, path: req.path },
    'Incoming request'
  );

  next();
});

// -----------------------------------------------------------------------------
// API Routes
// -----------------------------------------------------------------------------

app.use('/api', routes);

// Root route - API info
app.get('/', (_req, res) => {
  res.json({
    name: 'Prediction Platform API',
    version: '1.0.0',
    status: 'running',
    documentation: '/api/health',
  });
});

// -----------------------------------------------------------------------------
// Error Handling
// -----------------------------------------------------------------------------

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

export { app };
