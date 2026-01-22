import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { config } from '../config/index.js';
import { AppError, sendError } from '../utils/index.js';
import { ErrorCodes } from '../types/index.js';

// =============================================================================
// ERROR HANDLER MIDDLEWARE
// =============================================================================

/**
 * Global error handling middleware.
 * Catches all errors and returns consistent JSON responses.
 */
export const errorHandler: ErrorRequestHandler = (
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log error in development
  if (config.isDev) {
    console.error('Error:', error);
  }

  // Handle our custom AppError
  if (error instanceof AppError) {
    sendError(res, error);
    return;
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const appError = new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Validation failed',
      400,
      error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }))
    );
    sendError(res, appError);
    return;
  }

  // Handle Prisma errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const appError = handlePrismaError(error);
    sendError(res, appError);
    return;
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    const appError = new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Database validation error',
      400
    );
    sendError(res, appError);
    return;
  }

  // Handle JWT errors (if not caught by auth middleware)
  if (error.name === 'JsonWebTokenError') {
    const appError = new AppError(ErrorCodes.TOKEN_INVALID, 'Invalid token', 401);
    sendError(res, appError);
    return;
  }

  if (error.name === 'TokenExpiredError') {
    const appError = new AppError(ErrorCodes.TOKEN_EXPIRED, 'Token expired', 401);
    sendError(res, appError);
    return;
  }

  // Unknown error - return generic 500
  const appError = new AppError(
    ErrorCodes.INTERNAL_ERROR,
    config.isProd ? 'Internal server error' : error.message,
    500
  );
  sendError(res, appError);
};

/**
 * Handle Prisma-specific errors.
 */
function handlePrismaError(error: Prisma.PrismaClientKnownRequestError): AppError {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint violation
      const target = (error.meta?.target as string[])?.join(', ') ?? 'field';
      return new AppError(
        ErrorCodes.ALREADY_EXISTS,
        `A record with this ${target} already exists`,
        409
      );
    }

    case 'P2025': {
      // Record not found
      return new AppError(
        ErrorCodes.NOT_FOUND,
        'Record not found',
        404
      );
    }

    case 'P2003': {
      // Foreign key constraint failed
      return new AppError(
        ErrorCodes.INVALID_INPUT,
        'Referenced record does not exist',
        400
      );
    }

    case 'P2014': {
      // Required relation violation
      return new AppError(
        ErrorCodes.INVALID_INPUT,
        'Required relation violation',
        400
      );
    }

    default: {
      return new AppError(
        ErrorCodes.DATABASE_ERROR,
        config.isProd ? 'Database error' : `Database error: ${error.code}`,
        500
      );
    }
  }
}

// =============================================================================
// NOT FOUND HANDLER
// =============================================================================

/**
 * Handler for 404 - no route matched.
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const error = AppError.notFound(`Route ${req.method} ${req.path}`);
  sendError(res, error, 404);
}
