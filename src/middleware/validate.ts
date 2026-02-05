import type { Request, Response, NextFunction } from 'express';
import { z, type ZodSchema } from 'zod';

// =============================================================================
// VALIDATION MIDDLEWARE
// =============================================================================

/**
 * Creates middleware that validates request body against a Zod schema.
 * Parsed data replaces req.body.
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Creates middleware that validates request query params against a Zod schema.
 * Parsed data replaces req.query.
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Creates middleware that validates request params against a Zod schema.
 * Parsed data replaces req.params.
 */
export function validateParams<T extends ZodSchema>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  };
}

// =============================================================================
// COMMON VALIDATION SCHEMAS
// =============================================================================

/**
 * Pagination query params schema.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Common ID param schema.
 */
export const idParamSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

/**
 * Email schema with normalization.
 */
export const emailSchema = z
  .string()
  .email('Invalid email address')
  .transform((v) => v.toLowerCase().trim());

/**
 * Password schema with strength requirements.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

/**
 * Positive integer schema.
 */
export const positiveIntSchema = z.coerce.number().int().positive();

/**
 * Future date schema.
 */
export const futureDateSchema = z.coerce.date().refine(
  (date) => date.getTime() > Date.now(),
  { message: 'Date must be in the future' }
);
