import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError } from '../lib/api';
import { Button, Input, Card } from '../components/ui';

export function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [formError, setFormError] = useState('');

  const { register } = useAuth();
  const { success: showSuccess, error: showError } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const redirect = new URLSearchParams(location.search).get('redirect');
  const safeRedirect = redirect && redirect.startsWith('/') ? redirect : '/events';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const passwordStrengthPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
    let hasValidationError = false;

    setEmailError('');
    setPasswordError('');
    setConfirmPasswordError('');
    setFormError('');

    if (!trimmedEmail) {
      setEmailError('Enter your email address');
      hasValidationError = true;
    }

    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      hasValidationError = true;
    } else if (!passwordStrengthPattern.test(password)) {
      setPasswordError('Password must include uppercase, lowercase, and a number');
      hasValidationError = true;
    }

    if (password !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match');
      hasValidationError = true;
    }

    if (hasValidationError) {
      return;
    }

    setIsLoading(true);

    try {
      await register(trimmedEmail, password);
      showSuccess('Account created. Check your email for a verification link.');
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
          <h1 className="text-3xl font-bold text-gray-900">Create an account</h1>
          <p className="mt-2 text-gray-600">Start predicting and win rewards</p>
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

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError('');
                setConfirmPasswordError('');
                setFormError('');
              }}
              placeholder="••••••••"
              error={passwordError}
            />

            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setConfirmPasswordError('');
                setFormError('');
              }}
              placeholder="••••••••"
              error={confirmPasswordError}
            />

            <div className="text-xs text-gray-500">
              Password must contain at least 8 characters, one uppercase letter, one lowercase letter, and one number.
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              isLoading={isLoading}
            >
              Create Account
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link
              to={`/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
              className="text-primary-600 hover:underline font-medium"
            >
              Sign in
            </Link>
          </p>
        </Card>

        {/* Bonus info */}
        <div className="mt-6 p-4 bg-primary-50 rounded-lg text-sm text-primary-700 text-center">
          <span className="text-lg">🎁</span>
          <p className="font-medium">Your signup bonus is added to your wallet as soon as your account is created.</p>
        </div>
      </div>
    </div>
  );
}
