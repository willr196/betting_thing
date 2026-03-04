import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatTokens, formatPoints } from '../lib/utils';
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
          setStreakCount(result.rank.currentStreak);
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
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo & Nav Links */}
            <div className="flex items-center">
              <Link to="/" className="flex items-center">
                <span className="text-xl font-bold text-primary-600">🎯</span>
                <span className="ml-2 text-lg font-semibold text-gray-900">
                  Predict
                </span>
              </Link>

              {isAuthenticated && (
                <div className="hidden sm:flex sm:ml-8 sm:space-x-4">
                  <NavItem to="/events">Events</NavItem>
                  <NavItem to="/predictions">My Predictions</NavItem>
                  <NavItem to="/leagues">
                    Leagues
                    {leagueCount > 0 && (
                      <span className="ml-1 rounded-full bg-primary-600 px-1.5 py-0.5 text-xs text-white">
                        {leagueCount}
                      </span>
                    )}
                  </NavItem>
                  <NavItem to="/leaderboard">Leaderboard</NavItem>
                  <NavItem to="/transactions">Transactions</NavItem>
                  <NavItem to="/rewards">Rewards</NavItem>
                </div>
              )}
            </div>

            {/* Right side */}
            <div className="flex items-center space-x-4">
              {isAuthenticated ? (
                <>
                  <div className="flex items-center gap-2">
                    <Link
                      to="/wallet"
                      className="flex items-center px-3 py-1.5 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
                    >
                      <span className="text-lg mr-1">🪙</span>
                      <span className="font-semibold text-primary-700">
                        {formatTokens(user?.tokenBalance ?? 0)}
                      </span>
                    </Link>
                    <Link
                      to="/wallet"
                      className="flex items-center px-3 py-1.5 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
                    >
                      <span className="text-lg mr-1">🏆</span>
                      <span className="font-semibold text-emerald-700">
                        {formatPoints(user?.pointsBalance ?? 0)}
                      </span>
                    </Link>
                    {streakCount >= 2 && (
                      <div className="flex items-center px-3 py-1.5 bg-amber-50 rounded-lg text-amber-700">
                        <span className="mr-1 text-lg">🔥</span>
                        <span className="font-semibold">{streakCount}</span>
                      </div>
                    )}
                  </div>

                  {/* User Menu */}
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600 hidden sm:block">
                      {user?.email}
                    </span>
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
        {isAuthenticated && (
          <div className="sm:hidden border-t border-gray-200">
            <div className="flex justify-around py-2">
              <MobileNavItem to="/events">Events</MobileNavItem>
              <MobileNavItem to="/predictions">Predictions</MobileNavItem>
              <MobileNavItem to="/leagues">Leagues</MobileNavItem>
              <MobileNavItem to="/leaderboard">Leaders</MobileNavItem>
              <MobileNavItem to="/transactions">History</MobileNavItem>
              <MobileNavItem to="/rewards">Rewards</MobileNavItem>
              <MobileNavItem to="/wallet">Wallet</MobileNavItem>
            </div>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
        `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive
            ? 'text-primary-600 bg-primary-50'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
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
        `px-3 py-1 text-xs font-medium ${
          isActive ? 'text-primary-600' : 'text-gray-600'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
