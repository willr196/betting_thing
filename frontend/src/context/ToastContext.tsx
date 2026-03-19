import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

type ToastItem = {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  visible: boolean;
};

type ToastContextType = {
  showToast: (message: string, type: ToastType, duration?: number) => string;
  dismissToast: (id: string) => void;
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
};

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 4_000,
  info: 4_000,
  error: 6_000,
  warning: 6_000,
};

const MAX_VISIBLE_TOASTS = 3;
const EXIT_ANIMATION_MS = 220;

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastsRef = useRef<ToastItem[]>([]);
  const timeoutMapRef = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  useEffect(() => {
    return () => {
      for (const timers of timeoutMapRef.current.values()) {
        for (const timer of timers) {
          window.clearTimeout(timer);
        }
      }
      timeoutMapRef.current.clear();
    };
  }, []);

  const trackTimeout = (id: string, timer: number) => {
    const timers = timeoutMapRef.current.get(id) ?? [];
    timers.push(timer);
    timeoutMapRef.current.set(id, timers);
  };

  const clearTrackedTimeouts = (id: string) => {
    const timers = timeoutMapRef.current.get(id);
    if (!timers) {
      return;
    }

    for (const timer of timers) {
      window.clearTimeout(timer);
    }

    timeoutMapRef.current.delete(id);
  };

  const dismissToast = (id: string) => {
    const existingToast = toastsRef.current.find((toast) => toast.id === id);
    if (!existingToast) {
      return;
    }

    clearTrackedTimeouts(id);

    setToasts((previous) =>
      previous.map((toast) =>
        toast.id === id && toast.visible ? { ...toast, visible: false } : toast
      )
    );

    const removalTimer = window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
      timeoutMapRef.current.delete(id);
    }, EXIT_ANIMATION_MS);

    trackTimeout(id, removalTimer);
  };

  const showToast = (message: string, type: ToastType, duration?: number) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const resolvedDuration = duration ?? DEFAULT_DURATIONS[type];
    const visibleToasts = toastsRef.current.filter((toast) => toast.visible);

    if (visibleToasts.length >= MAX_VISIBLE_TOASTS) {
      dismissToast(visibleToasts[0].id);
    }

    setToasts((previous) => [
      ...previous,
      {
        id,
        message,
        type,
        duration: resolvedDuration,
        visible: false,
      },
    ]);

    const enterTimer = window.setTimeout(() => {
      setToasts((previous) =>
        previous.map((toast) => (toast.id === id ? { ...toast, visible: true } : toast))
      );
    }, 10);

    const dismissTimer = window.setTimeout(() => {
      dismissToast(id);
    }, resolvedDuration);

    trackTimeout(id, enterTimer);
    trackTimeout(id, dismissTimer);

    return id;
  };

  return (
    <ToastContext.Provider
      value={{
        showToast,
        dismissToast,
        success: (message, duration) => showToast(message, 'success', duration),
        error: (message, duration) => showToast(message, 'error', duration),
        info: (message, duration) => showToast(message, 'info', duration),
        warning: (message, duration) => showToast(message, 'warning', duration),
      }}
    >
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: () => void;
}) {
  const variantClasses: Record<ToastType, string> = {
    success: 'border-green-200 bg-green-50 text-green-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  };

  const iconByType: Record<ToastType, string> = {
    success: '✓',
    error: '!',
    info: 'i',
    warning: '!',
  };

  return (
    <div
      className={`pointer-events-auto min-w-[280px] max-w-sm rounded-2xl border px-4 py-3 shadow-[0_22px_50px_-28px_rgba(15,23,42,0.5)] transition-all duration-200 ${
        variantClasses[toast.type]
      } ${toast.visible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'}`}
      role={toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' || toast.type === 'warning' ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current/10 bg-white/55 text-sm font-semibold">
          {iconByType[toast.type]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-5">{toast.message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full px-2 py-1 text-xs font-semibold opacity-70 transition-opacity hover:opacity-100"
          aria-label="Dismiss notification"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
