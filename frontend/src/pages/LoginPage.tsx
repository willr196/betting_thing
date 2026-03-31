import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError } from '../lib/api';
import { Button, Input, Card } from '../components/ui';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formError, setFormError] = useState('');

  const { login } = useAuth();
  const { error: showError } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const redirect = new URLSearchParams(location.search).get('redirect');
  const safeRedirect = redirect && redirect.startsWith('/') ? redirect : '/events';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    let hasValidationError = false;

    setEmailError('');
    setPasswordError('');
    setFormError('');

    if (!trimmedEmail) {
      setEmailError('Enter your email address');
      hasValidationError = true;
    }

    if (!password) {
      setPasswordError('Enter your password');
      hasValidationError = true;
    }

    if (hasValidationError) {
      return;
    }

    setIsLoading(true);

    try {
      await login(trimmedEmail, password);
      navigate(safeRedirect);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'NETWORK_ERROR' || err.status === 0)) {
        showError(err.message);
      } else if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        showError('An unexpected error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Welcome back</h1>
          <p className="mt-2 text-gray-600">Sign in to your account</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError('');
                setFormError('');
              }}
              placeholder="you@example.com"
              error={emailError}
              autoFocus
            />

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">Password</span>
                <Link
                  to="/forgot-password"
                  className="text-sm text-primary-600 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError('');
                  setFormError('');
                }}
                placeholder="••••••••"
                error={passwordError}
              />
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              isLoading={isLoading}
            >
              Sign In
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-600">
            Don't have an account?{' '}
            <Link
              to={`/register${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
              className="text-primary-600 hover:underline font-medium"
            >
              Sign up
            </Link>
          </p>
          <p className="mt-2 text-center text-sm text-gray-500">
            Admin access?{' '}
            <Link to="/admin/login" className="font-medium text-primary-600 hover:underline">
              Use admin sign in
            </Link>
          </p>
        </Card>

        {import.meta.env.DEV && (
          <div className="mt-6 p-4 bg-gray-100 rounded-lg text-sm text-gray-600">
            <p className="font-medium mb-2">Seeded accounts (dev only):</p>
            <p>Admin email comes from <code>SEED_ADMIN_EMAIL</code>.</p>
            <p>User email comes from <code>SEED_USER_EMAIL</code>.</p>
            <p>Password comes from <code>SEED_PASSWORD</code>.</p>
          </div>
        )}
      </div>
    </div>
  );
}
