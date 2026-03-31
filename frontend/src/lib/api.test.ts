import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api';
import type { User } from '../types';

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'tester',
  tokenBalance: 5,
  pointsBalance: 0,
  isAdmin: false,
  isVerified: true,
  showPublicProfile: false,
  createdAt: '2026-03-13T00:00:00.000Z',
  updatedAt: '2026-03-13T00:00:00.000Z',
};

function createStorage() {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

function createStorageBundle() {
  return {
    tokenStorage: createStorage(),
    hintStorage: createStorage(),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient session hint', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks a session hint after login succeeds', async () => {
    const storage = createStorage();
    const client = new ApiClient(storage);
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          token: 'access-token',
          user: mockUser,
        },
      })
    );

    await client.login(mockUser.email, 'Password123!');

    expect(storage.getItem('auth_session_hint')).toBe('1');
    expect(storage.getItem('token')).toBe('access-token');
    expect(client.hasSessionHint()).toBe(true);
  });

  it('can keep the access token out of persistent hint storage', async () => {
    const storage = createStorageBundle();
    const client = new ApiClient(storage);
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          token: 'access-token',
          user: mockUser,
        },
      })
    );

    await client.login(mockUser.email, 'Password123!');

    expect(storage.tokenStorage.getItem('token')).toBe('access-token');
    expect(storage.hintStorage.getItem('token')).toBeNull();
    expect(storage.hintStorage.getItem('auth_session_hint')).toBe('1');
  });

  it('clears the session hint after refresh fails', async () => {
    const storage = createStorage();
    const client = new ApiClient(storage);
    const fetchMock = vi.mocked(fetch);

    storage.setItem('auth_session_hint', '1');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          error: {
            code: 'TOKEN_MISSING',
            message: 'No refresh token provided',
          },
        },
        401
      )
    );

    await expect(client.refresh()).rejects.toBeInstanceOf(ApiError);
    expect(storage.getItem('auth_session_hint')).toBeNull();
    expect(client.hasSessionHint()).toBe(false);
  });
});
