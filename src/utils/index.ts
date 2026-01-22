import type { Response } from 'express';
import type { ApiResponse, ErrorCode } from '../types/index.js';
import { ErrorCodes } from '../types/index.js';

// =============================================================================
// CUSTOM ERROR CLASS
// =============================================================================

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 400,
    details?: unknown
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'AppError';
    
    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  // Factory methods for common errors
  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(ErrorCodes.INVALID_INPUT, message, 400, details);
  }

  static unauthorized(message: string = 'Unauthorized'): AppError {
    return new AppError(ErrorCodes.UNAUTHORIZED, message, 401);
  }

  static forbidden(message: string = 'Forbidden'): AppError {
    return new AppError(ErrorCodes.FORBIDDEN, message, 403);
  }

  static notFound(resource: string): AppError {
    return new AppError(ErrorCodes.NOT_FOUND, `${resource} not found`, 404);
  }

  static conflict(message: string): AppError {
    return new AppError(ErrorCodes.CONFLICT, message, 409);
  }

  static insufficientBalance(required: number, available: number): AppError {
    return new AppError(
      ErrorCodes.INSUFFICIENT_BALANCE,
      `Insufficient balance. Required: ${required}, Available: ${available}`,
      400,
      { required, available }
    );
  }

  static internal(message: string = 'Internal server error'): AppError {
    return new AppError(ErrorCodes.INTERNAL_ERROR, message, 500);
  }
}

// =============================================================================
// RESPONSE HELPERS
// =============================================================================

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode: number = 200,
  meta?: ApiResponse['meta']
): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };
  
  if (meta) {
    response.meta = meta;
  }
  
  res.status(statusCode).json(response);
}

export function sendError(
  res: Response,
  error: AppError | Error,
  statusCode?: number
): void {
  const isAppError = error instanceof AppError;
  
  const response: ApiResponse = {
    success: false,
    error: {
      code: isAppError ? error.code : ErrorCodes.INTERNAL_ERROR,
      message: error.message,
      details: isAppError ? error.details : undefined,
    },
  };
  
  res.status(statusCode ?? (isAppError ? error.statusCode : 500)).json(response);
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isStrongPassword(password: string): { valid: boolean; message?: string } {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  return { valid: true };
}

// =============================================================================
// DATE HELPERS
// =============================================================================

export function isInFuture(date: Date): boolean {
  return date.getTime() > Date.now();
}

export function isInPast(date: Date): boolean {
  return date.getTime() < Date.now();
}

export function formatDate(date: Date): string {
  return date.toISOString();
}

// =============================================================================
// NUMBER HELPERS
// =============================================================================

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function roundToDecimal(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// =============================================================================
// ASYNC HELPERS
// =============================================================================

/**
 * Wraps an async function to catch errors and pass them to Express error handler.
 * Use this to wrap async route handlers.
 */
export function asyncHandler<T>(
  fn: (...args: T[]) => Promise<unknown>
): (...args: T[]) => void {
  return (...args: T[]) => {
    Promise.resolve(fn(...args)).catch((error) => {
      // The last argument should be next() in Express middleware
      const next = args[args.length - 1];
      if (typeof next === 'function') {
        next(error);
      }
    });
  };
}

// =============================================================================
// OBJECT HELPERS
// =============================================================================

/**
 * Omit specified keys from an object.
 * Useful for removing sensitive fields like passwordHash.
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

/**
 * Pick only specified keys from an object.
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}
