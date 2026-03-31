import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type AccountPreferences = {
  hideHeaderBalances: boolean;
  sessionReminderMinutes: 0 | 30 | 60 | 90;
};

type AccountSettingsContextType = {
  preferences: AccountPreferences;
  updatePreferences: (updates: Partial<AccountPreferences>) => void;
  resetPreferences: () => void;
};

const STORAGE_KEY = 'prediction-platform.account-preferences';

const DEFAULT_PREFERENCES: AccountPreferences = {
  hideHeaderBalances: false,
  sessionReminderMinutes: 60,
};

const SESSION_REMINDER_OPTIONS = new Set([0, 30, 60, 90]);

function readStoredPreferences(): AccountPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PREFERENCES;
    }

    const parsed = JSON.parse(raw) as Partial<AccountPreferences>;
    const sessionReminderMinutes = SESSION_REMINDER_OPTIONS.has(parsed.sessionReminderMinutes ?? -1)
      ? (parsed.sessionReminderMinutes as AccountPreferences['sessionReminderMinutes'])
      : DEFAULT_PREFERENCES.sessionReminderMinutes;

    return {
      hideHeaderBalances: parsed.hideHeaderBalances ?? DEFAULT_PREFERENCES.hideHeaderBalances,
      sessionReminderMinutes,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

const AccountSettingsContext = createContext<AccountSettingsContextType | null>(null);

export function AccountSettingsProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AccountPreferences>(readStoredPreferences);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Ignore storage write failures and keep the in-memory preferences active.
    }
  }, [preferences]);

  const updatePreferences = useCallback((updates: Partial<AccountPreferences>) => {
    setPreferences((current) => ({ ...current, ...updates }));
  }, []);

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
  }, []);

  return (
    <AccountSettingsContext.Provider value={{ preferences, updatePreferences, resetPreferences }}>
      {children}
    </AccountSettingsContext.Provider>
  );
}

export function useAccountSettings(): AccountSettingsContextType {
  const context = useContext(AccountSettingsContext);
  if (!context) {
    throw new Error('useAccountSettings must be used within an AccountSettingsProvider');
  }
  return context;
}
