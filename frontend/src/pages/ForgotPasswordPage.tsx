import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { Button, Input, Card } from '../components/ui';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();

    if (!trimmed) {
      setEmailError('Enter your email address');
      return;
    }

    setEmailError('');
    setIsLoading(true);

    try {
      await api.forgotPassword(trimmed);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.code !== 'NETWORK_ERROR') {
        // Still show success to prevent email enumeration
        setSubmitted(true);
      } else {
        setEmailError('Something went wrong. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Forgot password?</h1>
          <p className="mt-2 text-gray-600">
            {submitted
              ? "Check your inbox"
              : "We'll send you a link to reset it"}
          </p>
        </div>

        <Card>
          {submitted ? (
            <div className="text-center space-y-4">
              <p className="text-gray-700">
                If an account exists for <strong>{email}</strong>, a reset link has been sent. Check your spam folder if you don't see it.
              </p>
              <Link
                to="/login"
                className="block text-sm text-primary-600 hover:underline font-medium"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError('');
                }}
                placeholder="you@example.com"
                error={emailError}
                autoFocus
              />

              <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
                Send reset link
              </Button>

              <p className="text-center text-sm text-gray-600">
                <Link to="/login" className="text-primary-600 hover:underline font-medium">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
