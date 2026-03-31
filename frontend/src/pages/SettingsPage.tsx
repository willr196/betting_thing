import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  useAccountSettings,
  type AccountPreferences,
} from '../context/AccountSettingsContext';
import { useToast } from '../context/ToastContext';
import { ApiError, api } from '../lib/api';
import { formatDate } from '../lib/utils';
import { Badge, Button, Card, Input } from '../components/ui';

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9 _.-]+$/;

function anonymizeEmail(email: string): string {
  const localPart = email.split('@')[0] ?? email;
  return `${localPart.slice(0, 3)}***`;
}

function getProfilePreview(email: string, displayName: string, showPublicProfile: boolean): string {
  const trimmedDisplayName = displayName.trim();
  if (showPublicProfile && trimmedDisplayName) {
    return trimmedDisplayName;
  }

  return anonymizeEmail(email);
}

function validatePassword(password: string): string {
  if (password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  return '';
}

export function SettingsPage() {
  const { user, logout, updateUser } = useAuth();
  const { preferences, updatePreferences, resetPreferences } = useAccountSettings();
  const { success, error: showError } = useToast();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [showPublicProfile, setShowPublicProfile] = useState(false);
  const [profilePassword, setProfilePassword] = useState('');
  const [profileError, setProfileError] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [preferencesDraft, setPreferencesDraft] = useState<AccountPreferences>(preferences);
  const [isLoggingOutEverywhere, setIsLoggingOutEverywhere] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    setDisplayName(user.displayName ?? '');
    setEmail(user.email);
    setShowPublicProfile(user.showPublicProfile);
    setProfilePassword('');
    setProfileError('');
  }, [user]);

  useEffect(() => {
    setPreferencesDraft(preferences);
  }, [preferences]);

  if (!user) {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const trimmedDisplayName = displayName.trim();
  const emailChanged = normalizedEmail !== user.email;
  const displayNameChanged = trimmedDisplayName !== (user.displayName ?? '');
  const visibilityChanged = showPublicProfile !== user.showPublicProfile;
  const hasProfileChanges = emailChanged || displayNameChanged || visibilityChanged;
  const profilePreview = getProfilePreview(normalizedEmail || user.email, trimmedDisplayName, showPublicProfile);
  const hasPreferenceChanges =
    JSON.stringify(preferencesDraft) !== JSON.stringify(preferences);

  const handleProfileSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setProfileError('');

    if (!normalizedEmail) {
      setProfileError('Email address is required');
      return;
    }

    if (trimmedDisplayName && !DISPLAY_NAME_PATTERN.test(trimmedDisplayName)) {
      setProfileError('Display name can only use letters, numbers, spaces, dots, dashes, and underscores');
      return;
    }

    if (trimmedDisplayName && trimmedDisplayName.length < 2) {
      setProfileError('Display name must be at least 2 characters');
      return;
    }

    if (trimmedDisplayName.length > 32) {
      setProfileError('Display name must be 32 characters or fewer');
      return;
    }

    if (emailChanged && !profilePassword) {
      setProfileError('Current password is required to change your email');
      return;
    }

    if (!hasProfileChanges) {
      return;
    }

    setIsSavingProfile(true);

    try {
      const payload: {
        email?: string;
        currentPassword?: string;
        displayName?: string | null;
        showPublicProfile?: boolean;
      } = {};

      if (emailChanged) {
        payload.email = normalizedEmail;
        payload.currentPassword = profilePassword;
      }

      if (displayNameChanged) {
        payload.displayName = trimmedDisplayName || null;
      }

      if (visibilityChanged) {
        payload.showPublicProfile = showPublicProfile;
      }

      const result = await api.updateProfile(payload);
      updateUser(result.user);
      setProfilePassword('');
      success('Profile updated');
    } catch (error) {
      if (error instanceof ApiError) {
        setProfileError(error.message);
      } else {
        showError('Failed to update profile');
      }
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Fill in all password fields');
      return;
    }

    const validationError = validatePassword(newPassword);
    if (validationError) {
      setPasswordError(validationError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordError('Choose a new password instead of reusing the current one');
      return;
    }

    setIsChangingPassword(true);

    try {
      await api.changePassword(currentPassword, newPassword);
      success('Password updated. Sign in again with your new password.');
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setPasswordError(error.message);
      } else {
        showError('Failed to update password');
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSavePreferences = () => {
    updatePreferences(preferencesDraft);
    success('Device preferences updated');
  };

  const handleResetPreferences = () => {
    resetPreferences();
    success('Device preferences reset');
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handleLogoutEverywhere = async () => {
    setIsLoggingOutEverywhere(true);
    try {
      await api.logoutAll();
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to end all sessions');
      }
    } finally {
      setIsLoggingOutEverywhere(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[36px] border border-white/70 bg-[linear-gradient(135deg,rgba(27,49,67,0.98),rgba(34,94,94,0.94)_52%,rgba(194,120,37,0.88))] p-6 text-white shadow-[0_36px_90px_-54px_rgba(15,23,42,0.8)] sm:p-8">
        <div className="absolute -right-8 top-4 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-28 w-28 rounded-full bg-white/10 blur-3xl" />
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.34em] text-white/60">Account Centre</p>
          <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Settings</h1>
          <p className="mt-3 max-w-3xl text-sm text-white/78 sm:text-base">
            Profile, privacy, alerts, and account security. Inspired by sportsbook
            account centres, but adapted for a free-play product with no deposit
            or payment controls.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge className="border border-white/20 bg-white/10 text-white">
              Public preview: {profilePreview}
            </Badge>
            <Badge className="border border-white/20 bg-white/10 text-white">
              Member since {formatDate(user.createdAt)}
            </Badge>
            <Badge className="border border-white/20 bg-white/10 text-white">
              {user.isAdmin ? 'Admin account' : 'Player account'}
            </Badge>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-6">
          <Card>
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Profile Manager</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Manage the name people see in leagues and leaderboards, plus the email used to sign in.
                </p>
              </div>
              <Badge className="bg-slate-100 text-slate-700">{profilePreview}</Badge>
            </div>

            <form className="space-y-4" onSubmit={handleProfileSubmit}>
              <Input
                label="Display Name"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setProfileError('');
                }}
                placeholder="How you want to appear"
                maxLength={32}
              />

              <Input
                label="Email Address"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setProfileError('');
                }}
                placeholder="you@example.com"
              />

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50/70 px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  checked={showPublicProfile}
                  onChange={(event) => {
                    setShowPublicProfile(event.target.checked);
                    setProfileError('');
                  }}
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-900">
                    Show my display name publicly
                  </span>
                  <span className="mt-1 block text-sm text-gray-500">
                    When off, leagues and leaderboards fall back to an anonymised name like {anonymizeEmail(user.email)}.
                  </span>
                </span>
              </label>

              {emailChanged && (
                <Input
                  label="Current Password"
                  type="password"
                  value={profilePassword}
                  onChange={(event) => {
                    setProfilePassword(event.target.value);
                    setProfileError('');
                  }}
                  placeholder="Required to confirm email changes"
                />
              )}

              {profileError && <p className="text-sm text-red-600">{profileError}</p>}

              <div className="flex flex-wrap gap-3">
                <Button type="submit" isLoading={isSavingProfile} disabled={!hasProfileChanges}>
                  Save Profile
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setDisplayName(user.displayName ?? '');
                    setEmail(user.email);
                    setShowPublicProfile(user.showPublicProfile);
                    setProfilePassword('');
                    setProfileError('');
                  }}
                  disabled={!hasProfileChanges}
                >
                  Reset Changes
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Security</h2>
              <p className="mt-1 text-sm text-gray-500">
                Password updates invalidate existing sessions. You can also force a sign-out across every device.
              </p>
            </div>

            <form className="space-y-4" onSubmit={handlePasswordSubmit}>
              <Input
                label="Current Password"
                type="password"
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                  setPasswordError('');
                }}
                placeholder="Enter your current password"
              />
              <Input
                label="New Password"
                type="password"
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                  setPasswordError('');
                }}
                placeholder="Use at least 8 characters"
              />
              <Input
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setPasswordError('');
                }}
                placeholder="Re-enter your new password"
              />

              {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}

              <div className="flex flex-wrap gap-3">
                <Button type="submit" isLoading={isChangingPassword}>
                  Update Password
                </Button>
                <Button type="button" variant="ghost" onClick={handleLogout}>
                  Log Out
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={handleLogoutEverywhere}
                  isLoading={isLoggingOutEverywhere}
                >
                  Log Out Everywhere
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Device Preferences</h2>
              <p className="mt-1 text-sm text-gray-500">
                These are saved on this device today and both controls affect the app immediately.
              </p>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-gray-200 px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                checked={preferencesDraft.hideHeaderBalances}
                onChange={(event) => {
                  setPreferencesDraft((current) => ({
                    ...current,
                    hideHeaderBalances: event.target.checked,
                  }));
                }}
              />
              <span>
                <span className="block text-sm font-semibold text-gray-900">
                  Hide balances in the header
                </span>
                <span className="mt-1 block text-sm text-gray-500">
                  Useful on shared screens or when you want a cleaner navigation bar.
                </span>
              </span>
            </label>

            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700">Session reminder</label>
              <select
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={preferencesDraft.sessionReminderMinutes}
                onChange={(event) => {
                  setPreferencesDraft((current) => ({
                    ...current,
                    sessionReminderMinutes: Number(event.target.value) as AccountPreferences['sessionReminderMinutes'],
                  }));
                }}
              >
                <option value={0}>Off</option>
                <option value={30}>Every 30 minutes</option>
                <option value={60}>Every 60 minutes</option>
                <option value={90}>Every 90 minutes</option>
              </select>
              <p className="mt-1 text-sm text-gray-500">
                A local reminder similar to the “take a break” nudges betting apps use, without any money controls.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={handleSavePreferences} disabled={!hasPreferenceChanges}>
                Save Device Preferences
              </Button>
              <Button type="button" variant="secondary" onClick={handleResetPreferences}>
                Reset Defaults
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold text-gray-900">Account Notes</h2>
            <div className="mt-4 space-y-3 text-sm text-gray-600">
              <p>
                This platform is free-play only, so there are no deposit limits, withdrawals, payment methods, or verification settings here.
              </p>
              <p>
                The account area focuses on the parts that still matter in sportsbook-style products: profile visibility, secure sign-in, alerts, and clear ways to step away.
              </p>
              <p>
                If you enable a public display name, it appears in leagues and leaderboards. If not, the app keeps showing an anonymised identity.
              </p>
              <p>
                Additional alert controls will make more sense once the app has real notification delivery rather than placeholder toggles.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
