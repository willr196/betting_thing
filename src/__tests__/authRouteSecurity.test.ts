import type { Request, RequestHandler, Router } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TRUSTED_ORIGIN = 'https://frontend.test';
const TRUSTED_FRONTEND_URL_ENV = `${TRUSTED_ORIGIN}/login?source=render`;
const UNTRUSTED_ORIGIN = 'https://attacker.test';
const ORIGIN_OVERRIDE_ENV = 'ENFORCE_TRUSTED_FRONTEND_ORIGIN_IN_TEST';

type MockAuthService = {
  login: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  refreshAccessToken: ReturnType<typeof vi.fn>;
  revokeRefreshToken: ReturnType<typeof vi.fn>;
  createEmailVerificationToken: ReturnType<typeof vi.fn>;
  verifyEmail: ReturnType<typeof vi.fn>;
};

type MockResponse = {
  statusCode: number;
  body: unknown;
  sent: boolean;
  headers: Map<string, string | string[]>;
  cookiesSet: Array<{ name: string; value: string; options: unknown }>;
  cookiesCleared: Array<{ name: string; options: unknown }>;
  locals: Record<string, unknown>;
  _resolveCurrent?: () => void;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  cookie: (name: string, value: string, options: unknown) => MockResponse;
  clearCookie: (name: string, options: unknown) => MockResponse;
  setHeader: (name: string, value: string | string[]) => MockResponse;
  getHeader: (name: string) => string | string[] | undefined;
  append: (name: string, value: string) => MockResponse;
};

let authRouter: Router;
let authService: MockAuthService;
let previousFrontendUrl: string | undefined;
let previousOriginOverride: string | undefined;

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    sent: false,
    headers: new Map(),
    cookiesSet: [],
    cookiesCleared: [],
    locals: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.sent = true;
      this._resolveCurrent?.();
      return this;
    },
    cookie(name: string, value: string, options: unknown) {
      this.cookiesSet.push({ name, value, options });
      return this;
    },
    clearCookie(name: string, options: unknown) {
      this.cookiesCleared.push({ name, options });
      return this;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers.set(name.toLowerCase(), value);
      return this;
    },
    getHeader(name: string) {
      return this.headers.get(name.toLowerCase());
    },
    append(name: string, value: string) {
      const key = name.toLowerCase();
      const current = this.headers.get(key);
      if (current === undefined) {
        this.headers.set(key, value);
        return this;
      }

      if (Array.isArray(current)) {
        this.headers.set(key, [...current, value]);
        return this;
      }

      this.headers.set(key, [current, value]);
      return this;
    },
  };
}

function createMockRequest(options: {
  body?: Record<string, unknown>;
  cookies?: Record<string, string>;
  headers?: Record<string, string | undefined>;
  path: string;
}): Request {
  const headers = Object.fromEntries(
    Object.entries(options.headers ?? {}).filter(([, value]) => value !== undefined)
  ) as Record<string, string>;

  return {
    app: {
      get: () => undefined,
    },
    baseUrl: '/api/v1/auth',
    body: options.body ?? {},
    cookies: options.cookies ?? {},
    headers,
    ip: '127.0.0.1',
    method: 'POST',
    originalUrl: `/api/v1/auth${options.path}`,
    path: `/api/v1/auth${options.path}`,
    url: `/api/v1/auth${options.path}`,
  } as unknown as Request;
}

function getRouteHandlers(path: string): RequestHandler[] {
  const layer = (authRouter as unknown as {
    stack: Array<{
      route?: {
        path?: string;
        methods?: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
      };
    }>;
  }).stack.find((candidate) => candidate.route?.path === path && candidate.route.methods?.post);

  if (!layer?.route) {
    throw new Error(`Route not found for POST ${path}`);
  }

  const routeStack = layer.route.stack.map((entry) => entry.handle);
  const hasRateLimiter = path === '/login' || path === '/register' || path === '/refresh';

  // Skip the rate limiter for these unit-level route tests. The security-critical
  // logic under review starts after that layer.
  return (hasRateLimiter ? routeStack.slice(1) : routeStack);
}

async function invokeHandler(handler: RequestHandler, req: Request, res: MockResponse): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    res._resolveCurrent = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const next = (error?: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    try {
      handler(req, res as never, next);
    } catch (error) {
      settled = true;
      reject(error);
    }
  });
}

async function executePostRoute(options: {
  path: string;
  body?: Record<string, unknown>;
  cookies?: Record<string, string>;
  headers?: Record<string, string | undefined>;
}): Promise<{ req: Request; res: MockResponse }> {
  const handlers = getRouteHandlers(options.path);
  const req = createMockRequest(options);
  const res = createMockResponse();

  for (const handler of handlers) {
    await invokeHandler(handler, req, res);
    if (res.sent) {
      break;
    }
  }

  return { req, res };
}

describe('auth route trusted-origin security', () => {
  beforeAll(async () => {
    previousFrontendUrl = process.env.FRONTEND_URL;
    previousOriginOverride = process.env[ORIGIN_OVERRIDE_ENV];

    process.env.FRONTEND_URL = TRUSTED_FRONTEND_URL_ENV;
    process.env[ORIGIN_OVERRIDE_ENV] = 'true';

    authService = {
      login: vi.fn(),
      register: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeRefreshToken: vi.fn(),
      createEmailVerificationToken: vi.fn(),
      verifyEmail: vi.fn(),
    };

    vi.doMock('../services/auth.js', () => ({
      AuthService: authService,
    }));

    const imported = await import('../routes/auth.js');
    authRouter = imported.default as unknown as Router;
  });

  beforeEach(() => {
    authService.login.mockReset();
    authService.register.mockReset();
    authService.refreshAccessToken.mockReset();
    authService.revokeRefreshToken.mockReset();
    authService.createEmailVerificationToken.mockReset();
    authService.verifyEmail.mockReset();
  });

  afterAll(() => {
    vi.doUnmock('../services/auth.js');

    if (previousFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = previousFrontendUrl;
    }

    if (previousOriginOverride === undefined) {
      delete process.env[ORIGIN_OVERRIDE_ENV];
    } else {
      process.env[ORIGIN_OVERRIDE_ENV] = previousOriginOverride;
    }
  });

  it('blocks login attempts from untrusted origins before auth logic runs', async () => {
    authService.login.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', isAdmin: false },
      token: 'access-token',
      refreshToken: 'refresh-token',
    });

    const { res } = await executePostRoute({
      path: '/login',
      headers: {
        origin: UNTRUSTED_ORIGIN,
      },
      body: {
        email: 'user@example.com',
        password: 'Password123!',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Untrusted request origin',
      },
    });
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('allows trusted login requests and sets a refresh cookie', async () => {
    authService.login.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', isAdmin: false },
      token: 'access-token',
      refreshToken: 'refresh-token',
    });

    const { req, res } = await executePostRoute({
      path: '/login',
      headers: {
        referer: `${TRUSTED_ORIGIN}/login`,
      },
      body: {
        email: 'User@Example.com',
        password: 'Password123!',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        token: 'access-token',
        user: { id: 'user-1', email: 'user@example.com' },
      },
    });
    expect(authService.login).toHaveBeenCalledWith('user@example.com', 'Password123!');
    expect(req.body).toMatchObject({ email: 'user@example.com' });
    expect(res.cookiesSet).toContainEqual(
      expect.objectContaining({
        name: 'refresh_token',
        value: 'refresh-token',
      })
    );
  });

  it('blocks registration from untrusted origins before creating an account', async () => {
    authService.register.mockResolvedValue({
      user: { id: 'user-2', email: 'new@example.com', isAdmin: false },
      token: 'access-token',
      refreshToken: 'refresh-token',
    });

    const { res } = await executePostRoute({
      path: '/register',
      headers: {
        origin: UNTRUSTED_ORIGIN,
      },
      body: {
        email: 'new@example.com',
        password: 'Password123!',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('blocks refresh attempts from untrusted origins even when a cookie is present', async () => {
    authService.refreshAccessToken.mockResolvedValue({
      token: 'next-access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 'user-3', email: 'user@example.com', isAdmin: false },
    });

    const { res } = await executePostRoute({
      path: '/refresh',
      headers: {
        origin: UNTRUSTED_ORIGIN,
      },
      cookies: {
        refresh_token: 'stolen-cookie',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(authService.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('allows trusted refresh requests and rotates the refresh cookie', async () => {
    authService.refreshAccessToken.mockResolvedValue({
      token: 'next-access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 'user-3', email: 'user@example.com', isAdmin: false },
    });

    const { res } = await executePostRoute({
      path: '/refresh',
      headers: {
        origin: TRUSTED_ORIGIN,
      },
      cookies: {
        refresh_token: 'current-refresh-token',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        token: 'next-access-token',
        user: { id: 'user-3', email: 'user@example.com' },
      },
    });
    expect(authService.refreshAccessToken).toHaveBeenCalledWith('current-refresh-token');
    expect(res.cookiesSet).toContainEqual(
      expect.objectContaining({
        name: 'refresh_token',
        value: 'next-refresh-token',
      })
    );
  });

  it('verifies email tokens through the public confirmation route', async () => {
    authService.verifyEmail.mockResolvedValue(undefined);

    const { res } = await executePostRoute({
      path: '/verify-email',
      body: {
        token: 'verification-token',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        message: 'Email verified successfully. You can continue using your account.',
      },
    });
    expect(authService.verifyEmail).toHaveBeenCalledWith('verification-token');
  });

  it('blocks logout requests from untrusted origins before touching the refresh token', async () => {
    authService.refreshAccessToken.mockResolvedValue({
      token: 'ignored',
      refreshToken: 'ignored',
      user: { id: 'user-4', email: 'user@example.com', isAdmin: false },
    });

    const { res } = await executePostRoute({
      path: '/logout',
      headers: {
        origin: UNTRUSTED_ORIGIN,
      },
      cookies: {
        refresh_token: 'active-cookie',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(authService.refreshAccessToken).not.toHaveBeenCalled();
    expect(authService.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('clears the refresh cookie on trusted logout even when token revocation fails', async () => {
    authService.refreshAccessToken.mockRejectedValue(new Error('invalid token'));

    const { res } = await executePostRoute({
      path: '/logout',
      headers: {
        origin: TRUSTED_ORIGIN,
      },
      cookies: {
        refresh_token: 'expired-cookie',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        message: 'Logged out successfully',
      },
    });
    expect(authService.refreshAccessToken).toHaveBeenCalledWith('expired-cookie');
    expect(authService.revokeRefreshToken).not.toHaveBeenCalled();
    expect(res.cookiesCleared).toContainEqual(
      expect.objectContaining({
        name: 'refresh_token',
      })
    );
  });
});
