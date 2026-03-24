import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './ui';
import { useState } from 'react';

const NAV_SECTIONS = [
  {
    items: [
      { to: '/admin', label: 'Dashboard', icon: '📊', end: true },
      { to: '/admin/events', label: 'Events', icon: '🎯' },
      { to: '/admin/users', label: 'Users', icon: '👥' },
      { to: '/admin/rewards', label: 'Rewards', icon: '🎁' },
      { to: '/admin/system', label: 'System', icon: '⚙️' },
    ],
  },
];

export function AdminLayout() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login?redirect=%2Fadmin" replace />;
  }

  if (!user?.isAdmin) {
    return <Navigate to="/events" replace />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile header */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 sm:hidden">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="font-semibold text-gray-900">Admin</span>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
        >
          {sidebarOpen ? '✕' : '☰'}
        </button>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } fixed inset-y-0 left-0 z-20 w-56 border-r border-gray-200 bg-white transition-transform sm:relative sm:translate-x-0`}
        >
          <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-4">
            <span className="text-lg">⚡</span>
            <span className="font-semibold text-gray-900">Admin Panel</span>
          </div>

          <nav className="p-3">
            {NAV_SECTIONS.map((section, si) => (
              <div key={si} className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-primary-50 text-primary-700'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`
                    }
                  >
                    <span className="text-base">{item.icon}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}

            <div className="mt-4 border-t border-gray-100 pt-4">
              <NavLink
                to="/events"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              >
                ← Back to App
              </NavLink>
            </div>
          </nav>
        </aside>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-10 bg-black/20 sm:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
