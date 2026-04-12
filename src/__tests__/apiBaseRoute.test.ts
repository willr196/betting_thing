import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import router from '../routes/index.js';

type MockResponse = Response & {
  body?: unknown;
  statusCode: number;
};

function createMockResponse(): MockResponse {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  return response as MockResponse;
}

describe('API base route', () => {
  it('returns service metadata for GET /api/v1', () => {
    const layer = (
      router as unknown as {
        stack: Array<{
          route?: {
            path?: string;
            methods?: Record<string, boolean>;
            stack: Array<{ handle: (req: Request, res: Response) => void }>;
          };
        }>;
      }
    ).stack.find((candidate) => candidate.route?.path === '/' && candidate.route.methods?.get);

    expect(layer?.route).toBeDefined();

    const handler = layer!.route!.stack[0]!.handle;
    const res = createMockResponse();

    handler({} as Request, res as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        name: 'Prediction Platform API',
        version: '1.0.0',
        status: 'running',
        health: '/api/v1/health',
        live: '/api/v1/health/live',
      },
    });
  });
});
