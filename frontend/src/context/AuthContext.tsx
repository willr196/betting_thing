import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../lib/api';
import type { User } from '../types';

// =============================================================================
// AUTH CONTEXT TYPES
// =============================================================================

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

// =============================================================================
// CONTEXT
// =============================================================================

const AuthContext = createContext<AuthContextType | null>(null);

// =============================================================================
// PROVIDER
// =============================================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount:
  // 1. If a stored access token exists, validate it via /auth/me.
  // 2. If no token (or token is invalid/expired), try the refresh token cookie.
  // 3. If both fail, user is unauthenticated.
  useEffect(() => {
    async function restoreSession() {
      const token = api.getToken();

      if (token) {
        try {
          const data = await api.getMe();
          setUser(data.user);
          return;
        } catch (error) {
          // If expired, the request interceptor will already try to refresh.
          // If it gets here, both the access token and refresh failed.
          if (error instanceof ApiError && error.status === 401) {
            api.setToken(null);
            // Fall through to try the refresh cookie directly
          } else {
            setIsLoading(false);
            return;
          }
        }
      }

      // No valid access token — attempt silent refresh via cookie
      try {
        const data = await api.refresh();
        setUser(data.user);
      } catch {
        // No valid refresh token either — user needs to log in
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    restoreSession();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.login(email, password);
    setUser(data.user);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const data = await api.register(email, password);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.getMe();
      setUser(data.user);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await logout();
      }
    }
  }, [logout]);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// =============================================================================
// HOOK
// =============================================================================

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
