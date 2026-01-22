import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
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
        <Route index element={<LoginPage />} />
      </Route>

      <Route
        path="/register"
        element={
          <PublicRoute>
            <Layout />
          </PublicRoute>
        }
      >
        <Route index element={<RegisterPage />} />
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
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventDetailPage />} />
        <Route path="predictions" element={<PredictionsPage />} />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="wallet" element={<WalletPage />} />
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
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
