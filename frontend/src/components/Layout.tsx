import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatTokens, formatPoints } from '../lib/utils';
import { BetSlip } from './BetSlip';
import { Button } from './ui';

// =============================================================================
// LAYOUT
// =============================================================================

export function Layout() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [streakCount, setStreakCount] = useState(0);
  const [leagueCount, setLeagueCount] = useState(0);

  useEffect(() => {
    let isCancelled = false;

    async function loadStreak() {
      if (!isAuthenticated) {
        setStreakCount(0);
        return;
      }

      try {
        const result = await api.getMyLeaderboardRank('all-time');
        if (!isCancelled) {
          setStreakCount(result.rank?.currentStreak ?? 0);
        }
      } catch {
        if (!isCancelled) {
          setStreakCount(0);
        }
      }
    }

    void loadStreak();

    return () => {
      isCancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    let isCancelled = false;

    async function loadLeagueCount() {
      if (!isAuthenticated) {
        setLeagueCount(0);
        return;
      }

      try {
        const result = await api.getMyLeagues();
        if (!isCancelled) {
          setLeagueCount(result.leagues.length);
        }
      } catch {
        if (!isCancelled) {
          setLeagueCount(0);
        }
      }
    }

    void loadLeagueCount();

    return () => {
      isCancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-30 px-3 pt-3 sm:px-6">
        <nav className="mx-auto max-w-7xl overflow-hidden rounded-[30px] border border-white/75 bg-white/82 shadow-[0_28px_70px_-48px_rgba(15,23,42,0.55)] backdrop-blur-2xl">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex min-h-16 justify-between gap-4 py-3">
              {/* Logo & primary nav */}
              <div className="flex items-center gap-3">
                <Link to="/" className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(47,114,106,1),rgba(199,103,23,0.92))] text-lg shadow-[0_18px_35px_-18px_rgba(47,114,106,0.95)]">
                    🎯
                  </span>
                  <div>
                    <p className="text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-gray-400">
                      Prediction Platform
                    </p>
                    <span className="text-lg font-semibold text-gray-900">Predict</span>
                  </div>
                </Link>

                {isAuthenticated && (
                  <div className="hidden sm:flex sm:ml-6 sm:items-center sm:gap-1">
                    {/* Primary navigation */}
                    <NavItem to="/events">Events</NavItem>
                    <NavItem to="/football">Football</NavItem>
                    <NavItem to="/predictions">My Picks</NavItem>
                    <NavItem to="/leagues">
                      Leagues
                      {leagueCount > 0 && (
                        <span className="ml-1 rounded-full bg-primary-600 px-1.5 py-0.5 text-xs text-white">
                          {leagueCount}
                        </span>
                      )}
                    </NavItem>
                    <NavItem to="/leaderboard">Leaderboard</NavItem>

                    {/* Visual separator */}
                    <div className="mx-2 h-4 w-px bg-gray-200" />

                    {/* Utility navigation */}
                    <NavItemSecondary to="/transactions">Activity</NavItemSecondary>
                    <NavItemSecondary to="/rewards">Rewards</NavItemSecondary>
                    <NavItemSecondary to="/promotions">Promotions</NavItemSecondary>
                    <NavItemSecondary to="/minigames">Minigames</NavItemSecondary>
                  </div>
                )}

                {!isAuthenticated && (
                  <div className="hidden sm:flex sm:ml-6">
                    <NavItem to="/leaderboard">Leaderboard</NavItem>
                  </div>
                )}
              </div>

              {/* Right side */}
              <div className="flex items-center gap-3">
                {isAuthenticated ? (
                  <>
                    <div className="hidden items-center gap-2 lg:flex">
                      <Link
                        to="/wallet"
                        className="flex items-center rounded-full border border-primary-100 bg-primary-50/90 px-3 py-1.5 transition-colors hover:bg-primary-100"
                      >
                        <span className="mr-1 text-lg">🪙</span>
                        <span className="font-semibold text-primary-700">
                          {formatTokens(user?.tokenBalance ?? 0)}
                        </span>
                      </Link>
                      <Link
                        to="/wallet"
                        className="flex items-center rounded-full border border-emerald-100 bg-emerald-50/90 px-3 py-1.5 transition-colors hover:bg-emerald-100"
                      >
                        <span className="mr-1 text-lg">🏆</span>
                        <span className="font-semibold text-emerald-700">
                          {formatPoints(user?.pointsBalance ?? 0)}
                        </span>
                      </Link>
                      {streakCount >= 2 && (
                        <div className="flex items-center rounded-lg bg-amber-50 px-3 py-1.5 text-amber-700">
                          <span className="mr-1 text-lg">🔥</span>
                          <span className="font-semibold">{streakCount}</span>
                        </div>
                      )}
                    </div>

                    {/* User actions */}
                    <div className="flex items-center gap-2">
                      <span className="hidden text-sm text-gray-500 sm:block">{user?.email}</span>
                      <Button variant="ghost" size="sm" onClick={handleLogout}>
                        Logout
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center space-x-2">
                    <Link to="/login">
                      <Button variant="ghost" size="sm">
                        Login
                      </Button>
                    </Link>
                    <Link to="/register">
                      <Button size="sm">Sign Up</Button>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile nav */}
          <div className="border-t border-white/70 sm:hidden">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 px-3 py-3">
              {isAuthenticated ? (
                <>
                  <MobileNavItem to="/events">Events</MobileNavItem>
                  <MobileNavItem to="/football">Football</MobileNavItem>
                  <MobileNavItem to="/predictions">My Picks</MobileNavItem>
                  <MobileNavItem to="/leagues">Leagues</MobileNavItem>
                  <MobileNavItem to="/leaderboard">Leaderboard</MobileNavItem>
                  <span className="h-3 w-px bg-gray-200" />
                  <MobileNavItem to="/transactions">Activity</MobileNavItem>
                  <MobileNavItem to="/rewards">Rewards</MobileNavItem>
                  <MobileNavItem to="/promotions">Promotions</MobileNavItem>
                  <MobileNavItem to="/minigames">Minigames</MobileNavItem>
                  <MobileNavItem to="/wallet">Wallet</MobileNavItem>
                </>
              ) : (
                <MobileNavItem to="/leaderboard">Leaderboard</MobileNavItem>
              )}
            </div>
          </div>
        </nav>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <Outlet />
      </main>

      {isAuthenticated && <BetSlip />}

      <footer className="mt-auto px-4 pb-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-[28px] border border-white/75 bg-white/82 px-4 py-6 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500">
            © {new Date().getFullYear()} Prediction Platform. Play responsibly.
          </p>
        </div>
      </footer>
    </div>
  );
}

// =============================================================================
// NAV ITEMS
// =============================================================================

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-full px-3.5 py-2 text-sm font-semibold transition-colors ${
          isActive
            ? 'bg-primary-50 text-primary-700'
            : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function NavItemSecondary({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-full px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-gray-100 text-gray-700'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function MobileNavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-full px-3 py-1.5 text-xs font-semibold ${
          isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-500'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
