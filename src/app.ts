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

// Helmet sets various HTTP headers for security.
// CSP is configured explicitly for this API:
//   - defaultSrc/scriptSrc/styleSrc locked to 'self' (no inline content)
//   - connectSrc allows the configured frontend origin so browsers honour CSRF preflight
//   - frameSrc/objectSrc blocked entirely — this is a pure API, never embeddable
//   - upgradeInsecureRequests only applied in production (dev runs on HTTP)
const cspConnectSrc: string[] = ["'self'"];
if (config.server.frontendUrl) {
  cspConnectSrc.push(config.server.frontendUrl);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      connectSrc: cspConnectSrc,
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      ...(config.isProd ? { upgradeInsecureRequests: [] } : { upgradeInsecureRequests: null }),
    },
  },
}));

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
  skip: (req) =>
    req.path.endsWith('/auth/login') || req.path.endsWith('/auth/register'),
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
  const requestStartedAt = process.hrtime.bigint();
  const request = req as express.Request & {
    requestId: string;
    user?: { userId: string };
  };
  request.requestId = requestId;

  logger.info(
    { requestId, method: req.method, path: req.path },
    'Incoming request'
  );

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - requestStartedAt) / 1_000_000;

    logger.info(
      {
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: request.user?.userId ?? null,
      },
      'Request completed'
    );
  });

  next();
});

// -----------------------------------------------------------------------------
// API Routes
// -----------------------------------------------------------------------------

app.use('/api/v1', routes);

// Root route - API info
app.get('/', (_req, res) => {
  res.json({
    name: 'Prediction Platform API',
    version: '1.0.0',
    status: 'running',
    documentation: '/api/v1/health',
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
