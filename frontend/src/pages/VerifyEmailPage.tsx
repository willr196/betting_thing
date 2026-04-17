import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { Card, Spinner } from '../components/ui';

type VerificationState = 'loading' | 'success' | 'error';

function getVerificationErrorMessage(error: ApiError): string {
  if (error.code === 'TOKEN_EXPIRED') {
    return 'This verification link has expired. Sign in and request a new one from Settings.';
  }

  if (error.code === 'TOKEN_INVALID') {
    return 'This verification link is invalid or has already been used.';
  }

  return error.message;
}

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { user, updateUser } = useAuth();
  const [state, setState] = useState<VerificationState>(token ? 'loading' : 'error');
  const [message, setMessage] = useState(
    token ? 'Confirming your email address...' : 'This verification link is invalid or incomplete.'
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    let isCancelled = false;
    const currentUser = user;

    async function verify() {
      try {
        const result = await api.verifyEmail(token);
        if (isCancelled) {
          return;
        }

        if (currentUser) {
          updateUser({
            ...currentUser,
            isVerified: true,
          });
        }

        setState('success');
        setMessage(result.message);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setState('error');
        if (error instanceof ApiError) {
          setMessage(getVerificationErrorMessage(error));
          return;
        }

        setMessage('Something went wrong while verifying your email. Please try again.');
      }
    }

    void verify();

    return () => {
      isCancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Verify email</h1>
          <p className="mt-2 text-gray-600">Confirm your address to keep your account details up to date</p>
        </div>

        <Card>
          <div className="space-y-5 text-center">
            {state === 'loading' && (
              <div className="flex justify-center">
                <Spinner />
              </div>
            )}

            <p className="text-gray-700">{message}</p>

            {state === 'success' && (
              <div className="space-y-3">
                <Link
                  to={user ? '/settings' : '/login'}
                  className="inline-flex w-full items-center justify-center rounded-full bg-primary-600 px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:bg-primary-700"
                >
                  {user ? 'Back to settings' : 'Go to sign in'}
                </Link>
                <Link
                  to={user ? '/events' : '/register'}
                  className="block text-sm font-medium text-primary-600 hover:underline"
                >
                  {user ? 'Continue to events' : 'Need an account? Sign up'}
                </Link>
              </div>
            )}

            {state === 'error' && (
              <div className="space-y-3">
                {user && (
                  <Link
                    to="/settings"
                    className="inline-flex w-full items-center justify-center rounded-full bg-primary-600 px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:bg-primary-700"
                  >
                    Open settings
                  </Link>
                )}
                <Link
                  to={user ? '/settings' : '/login'}
                  className="block text-sm font-medium text-primary-600 hover:underline"
                >
                  {user ? 'Request a new verification email' : 'Back to sign in'}
                </Link>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
