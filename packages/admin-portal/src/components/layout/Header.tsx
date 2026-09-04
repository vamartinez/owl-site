import { useState, useRef, useEffect } from 'react';
import { Menu, Bell, LogOut, User, ChevronDown } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const tenantId = useAuthStore((s) => s.tenantId);
  const logout = useAuthStore((s) => s.logout);
  const [showProfile, setShowProfile] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setShowProfile(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="flex items-center h-header px-4 bg-white border-b border-gray-200">
      {/* Mobile menu toggle */}
      <button
        onClick={onMenuToggle}
        className="p-2 rounded-md hover:bg-gray-100 lg:hidden"
        aria-label="Toggle menu"
      >
        <Menu size={20} />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side actions */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button
          className="relative p-2 rounded-md hover:bg-gray-100 text-gray-600"
          aria-label="Notifications"
        >
          <Bell size={20} />
        </button>

        {/* User info + Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="flex items-center gap-2 pl-3 border-l border-gray-200 hover:bg-gray-50 rounded-md py-1 px-2 transition-colors"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary-100 text-primary-700">
              <User size={16} />
            </div>
            {user && (
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-gray-700 leading-tight">
                  {user.name}
                </p>
                <p className="text-xs text-gray-500 leading-tight capitalize">
                  {(role || '').replace(/_/g, ' ')}
                </p>
              </div>
            )}
            <ChevronDown size={14} className="text-gray-400" />
          </button>

          {/* Profile Dropdown */}
          {showProfile && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary-100 text-primary-700">
                    <User size={24} />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{user?.name || 'Usuario'}</p>
                    <p className="text-sm text-gray-500">{user?.email || ''}</p>
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Rol</span>
                  <span className="text-sm font-medium text-gray-900 capitalize bg-primary-50 px-2 py-0.5 rounded">
                    {(role || '').replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Correo</span>
                  <span className="text-sm text-gray-900">{user?.email || '-'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Tenant</span>
                  <span className="text-sm text-gray-900 font-mono text-xs">{tenantId || '-'}</span>
                </div>
                {user?.assignedSites && user.assignedSites.length > 0 && (
                  <div className="flex justify-between items-start">
                    <span className="text-sm text-gray-500">Sitios</span>
                    <span className="text-sm text-gray-900 text-right">
                      {user.assignedSites.join(', ')}
                    </span>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-100 p-2">
                <button
                  onClick={() => {
                    setShowProfile(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors"
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
