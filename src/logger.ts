import pino from 'pino';

// =============================================================================
// LOGGER
// =============================================================================
// Pino structured logger. JSON output in production, pretty-printed in dev.

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: isDev ? 'debug' : 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'body.password',
      'body.currentPassword',
      'body.newPassword',
      'password',
      'currentPassword',
      'newPassword',
      'token',
      'refreshToken',
      'resetUrl',
    ],
    censor: '[Redacted]',
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});
