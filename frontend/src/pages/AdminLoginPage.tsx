import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError } from '../lib/api';
import { Button, Input, Card } from '../components/ui';

export function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formError, setFormError] = useState('');

  const { login, logout } = useAuth();
  const { error: showError } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const redirect = new URLSearchParams(location.search).get('redirect');
  const safeRedirect = redirect && redirect.startsWith('/admin') ? redirect : '/admin';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    let hasValidationError = false;

    setEmailError('');
    setPasswordError('');
    setFormError('');

    if (!trimmedEmail) {
      setEmailError('Enter your admin email address');
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
      const user = await login(trimmedEmail, password);

      if (!user.isAdmin) {
        await logout();
        setFormError('This account does not have admin access.');
        return;
      }

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
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gray-400">
            Admin
          </p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">Admin sign in</h1>
          <p className="mt-2 text-gray-600">Access event controls, odds editing, and settlement.</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Admin Email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError('');
                setFormError('');
              }}
              placeholder="admin@example.com"
              error={emailError}
              autoFocus
            />

            <Input
              label="Password"
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

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              isLoading={isLoading}
            >
              Sign In To Admin
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-between text-sm text-gray-600">
            <Link to="/login" className="font-medium text-primary-600 hover:underline">
              Standard login
            </Link>
            <Link to="/events" className="hover:underline">
              Back to app
            </Link>
          </div>
        </Card>

        {import.meta.env.DEV && (
          <div className="mt-6 rounded-lg bg-gray-100 p-4 text-sm text-gray-600">
            <p className="mb-2 font-medium">Seeded admin account (dev only):</p>
            <p>Email comes from <code>SEED_ADMIN_EMAIL</code>.</p>
            <p>Password comes from <code>SEED_PASSWORD</code>.</p>
          </div>
        )}
      </div>
    </div>
  );
}
