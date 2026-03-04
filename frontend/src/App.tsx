import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  LoginPage,
  RegisterPage,
  EventsPage,
  EventDetailPage,
  PredictionsPage,
  LeaderboardPage,
  RewardsPage,
  TransactionsPage,
  WalletPage,
  LeaguesPage,
  LeagueDetailPage,
  LeagueSettingsPage,
  LeagueJoinPage,
} from './pages';

// =============================================================================
// PROTECTED ROUTE
// =============================================================================

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  return <>{children}</>;
}

// =============================================================================
// PUBLIC ROUTE (redirect if already authenticated)
// =============================================================================

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isAuthenticated) {
    const redirect = new URLSearchParams(location.search).get('redirect');
    const safeRedirect = redirect && redirect.startsWith('/') ? redirect : '/events';
    return <Navigate to={safeRedirect} replace />;
  }

  return <>{children}</>;
}

// =============================================================================
// APP ROUTES
// =============================================================================

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Layout />
          </PublicRoute>
        }
      >
        <Route index element={<ErrorBoundary><LoginPage /></ErrorBoundary>} />
      </Route>

      <Route
        path="/register"
        element={
          <PublicRoute>
            <Layout />
          </PublicRoute>
        }
      >
        <Route index element={<ErrorBoundary><RegisterPage /></ErrorBoundary>} />
      </Route>

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/events" replace />} />
        <Route path="events" element={<ErrorBoundary><EventsPage /></ErrorBoundary>} />
        <Route path="events/:id" element={<ErrorBoundary><EventDetailPage /></ErrorBoundary>} />
        <Route path="predictions" element={<ErrorBoundary><PredictionsPage /></ErrorBoundary>} />
        <Route path="leaderboard" element={<ErrorBoundary><LeaderboardPage /></ErrorBoundary>} />
        <Route path="leagues" element={<ErrorBoundary><LeaguesPage /></ErrorBoundary>} />
        <Route path="leagues/join" element={<ErrorBoundary><LeagueJoinPage /></ErrorBoundary>} />
        <Route path="leagues/:id" element={<ErrorBoundary><LeagueDetailPage /></ErrorBoundary>} />
        <Route path="leagues/:id/settings" element={<ErrorBoundary><LeagueSettingsPage /></ErrorBoundary>} />
        <Route path="rewards" element={<ErrorBoundary><RewardsPage /></ErrorBoundary>} />
        <Route path="transactions" element={<ErrorBoundary><TransactionsPage /></ErrorBoundary>} />
        <Route path="wallet" element={<ErrorBoundary><WalletPage /></ErrorBoundary>} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// =============================================================================
// APP
// =============================================================================

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
