import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.js';
import { prisma } from '../services/database.js';
import { AppError } from '../utils/index.js';
import type { AuthenticatedRequest, JwtPayload } from '../types/index.js';

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

/**
 * Middleware to require authentication.
 * Extracts JWT from Authorization header, verifies it, and attaches user to request.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw AppError.unauthorized('No authorization header provided');
    }

    // Expect format: "Bearer <token>"
    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw AppError.unauthorized('Invalid authorization header format');
    }

    const token = parts[1];

    if (!token) {
      throw AppError.unauthorized('No token provided');
    }

    // Verify token signature and expiry
    const payload = AuthService.verifyToken(token);

    // Verify tokenVersion matches DB — allows instant revocation on password change
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true },
    });

    if (!user || user.tokenVersion !== payload.tokenVersion) {
      throw AppError.unauthorized('Token has been revoked');
    }

    // Attach user to request
    (req as AuthenticatedRequest).user = payload;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to require admin privileges.
 * Must be used AFTER requireAuth middleware.
 */
export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authReq = req as AuthenticatedRequest;

  if (!authReq.user) {
    return next(AppError.unauthorized('Authentication required'));
  }

  if (!authReq.user.isAdmin) {
    return next(AppError.forbidden('Admin access required'));
  }

  next();
}

/**
 * Optional auth middleware.
 * Attaches user to request if valid token provided, but doesn't require it.
 */
export function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return next();
    }

    const parts = authHeader.split(' ');
    
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
      return next();
    }

    const token = parts[1];

    try {
      const payload = AuthService.verifyToken(token);
      (req as AuthenticatedRequest).user = payload;
    } catch {
      // Invalid token, but that's okay for optional auth
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Type guard helper to check if request is authenticated.
 */
export function getAuthUser(req: Request): JwtPayload {
  const authReq = req as AuthenticatedRequest;
  
  if (!authReq.user) {
    throw AppError.unauthorized('Authentication required');
  }
  
  return authReq.user;
}
