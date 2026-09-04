import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth-store';

/**
 * Auth state hook with Cognito integration.
 * Handles initialization, activity tracking, and session expiry redirect.
 */
export function useAuth() {
  const {
    user,
    tokens,
    tenantId,
    role,
    isAuthenticated,
    isLoading,
    initialize,
    logout,
    updateActivity,
  } = useAuthStore();

  const navigate = useNavigate();
  const location = useLocation();

  // Initialize auth state on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Track user activity for inactivity timeout
  useEffect(() => {
    if (!isAuthenticated) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handleActivity = () => updateActivity();

    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [isAuthenticated, updateActivity]);

  // Redirect to login if not authenticated (after loading)
  useEffect(() => {
    if (!isLoading && !isAuthenticated && location.pathname !== '/login') {
      sessionStorage.setItem('intendedDestination', location.pathname);
      navigate('/login', { replace: true });
    }
  }, [isLoading, isAuthenticated, location.pathname, navigate]);

  return {
    user,
    tokens,
    tenantId,
    role,
    isAuthenticated,
    isLoading,
    logout,
  };
}
