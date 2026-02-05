import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/index.js';

// =============================================================================
// EXPRESS APP CONFIGURATION
// =============================================================================

const app = express();

// -----------------------------------------------------------------------------
// Security Middleware
// -----------------------------------------------------------------------------

// Helmet sets various HTTP headers for security
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: config.server.frontendUrl || false,
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
// Body Parsing
// -----------------------------------------------------------------------------

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// -----------------------------------------------------------------------------
// Request Logging (Development)
// -----------------------------------------------------------------------------

if (config.isDev) {
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

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
