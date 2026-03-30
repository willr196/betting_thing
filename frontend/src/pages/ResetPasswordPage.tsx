import { useState, type FormEvent } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { Button, Input, Card } from '../components/ui';
import { useToast } from '../context/ToastContext';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { success: showSuccess } = useToast();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [formError, setFormError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!token) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="w-full max-w-md">
          <Card>
            <p className="text-center text-gray-700 mb-4">
              This reset link is invalid or has expired.
            </p>
            <Link
              to="/forgot-password"
              className="block text-center text-sm text-primary-600 hover:underline font-medium"
            >
              Request a new reset link
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    let hasError = false;

    setPasswordError('');
    setConfirmError('');
    setFormError('');

    if (!password) {
      setPasswordError('Enter a new password');
      hasError = true;
    }

    if (!confirm) {
      setConfirmError('Confirm your new password');
      hasError = true;
    } else if (password && password !== confirm) {
      setConfirmError('Passwords do not match');
      hasError = true;
    }

    if (hasError) return;

    setIsLoading(true);
    try {
      await api.resetPassword(token, password);
      showSuccess('Password updated. Please sign in.');
      navigate('/login');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'TOKEN_EXPIRED') {
          setFormError('This reset link has expired. Please request a new one.');
        } else if (err.code === 'TOKEN_INVALID') {
          setFormError('This reset link is invalid or has already been used.');
        } else if (err.code === 'VALIDATION_ERROR') {
          setPasswordError(err.message);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Set new password</h1>
          <p className="mt-2 text-gray-600">Choose a strong password for your account</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="New password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError('');
                setFormError('');
              }}
              placeholder="••••••••"
              error={passwordError}
              autoFocus
            />

            <Input
              label="Confirm new password"
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setConfirmError('');
                setFormError('');
              }}
              placeholder="••••••••"
              error={confirmError}
            />

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            {(formError === 'This reset link has expired. Please request a new one.' ||
              formError === 'This reset link is invalid or has already been used.') && (
              <Link
                to="/forgot-password"
                className="block text-center text-sm text-primary-600 hover:underline"
              >
                Request a new reset link
              </Link>
            )}

            <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
              Update password
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
