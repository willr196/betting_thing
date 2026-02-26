import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  LoginPage,
  RegisterPage,
  EventsPage,
  EventDetailPage,
  PredictionsPage,
  RewardsPage,
  WalletPage,
} from './pages';

// =============================================================================
// PROTECTED ROUTE
// =============================================================================

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// =============================================================================
// PUBLIC ROUTE (redirect if already authenticated)
// =============================================================================

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/events" replace />;
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
        <Route path="rewards" element={<ErrorBoundary><RewardsPage /></ErrorBoundary>} />
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
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
