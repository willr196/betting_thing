import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatTokens, formatPoints } from '../lib/utils';
import { Button } from './ui';

// =============================================================================
// LAYOUT
// =============================================================================

export function Layout() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

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
            © 2024 Prediction Platform. Play responsibly.
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
