import { useState, useCallback } from 'react';

/**
 * Session-level disclaimer acknowledgment state.
 * Tracks whether the user has acknowledged the AI disclaimer during the current session.
 * The acknowledgment resets when the page is refreshed (session-level, not persisted).
 *
 * Usage:
 * - Check `hasAcknowledged` before allowing validation requests
 * - If not acknowledged, show the DisclaimerModal
 * - Call `acknowledge()` when the user accepts the disclaimer
 *
 * Validates: Requirements 12.2
 */

// Module-level state to persist across component re-renders within the same session.
// Resets on page refresh (session-level behavior per requirement 12.2).
let sessionAcknowledged = false;

export interface UseDisclaimerAckReturn {
  hasAcknowledged: boolean;
  acknowledge: () => void;
  reset: () => void;
}

export function useDisclaimerAck(): UseDisclaimerAckReturn {
  const [hasAcknowledged, setHasAcknowledged] = useState(sessionAcknowledged);

  const acknowledge = useCallback(() => {
    sessionAcknowledged = true;
    setHasAcknowledged(true);
  }, []);

  const reset = useCallback(() => {
    sessionAcknowledged = false;
    setHasAcknowledged(false);
  }, []);

  return {
    hasAcknowledged,
    acknowledge,
    reset,
  };
}
