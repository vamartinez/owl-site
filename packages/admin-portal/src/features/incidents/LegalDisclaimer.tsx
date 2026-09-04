import { useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../../components/ui/Button';

const DISCLAIMER_TEXT =
  'The regulatory suggestions provided by this system are operational support and do not constitute legal advice. Consult with a qualified legal professional to determine your specific regulatory obligations.';

const SESSION_STORAGE_KEY = 'incident_legal_disclaimer_acknowledged';

export interface LegalDisclaimerProps {
  /** When true, requires the user to acknowledge the disclaimer before proceeding */
  requireAcknowledgment?: boolean;
  /** Render variant: 'inline' for embedded display, 'footer' for export footers */
  variant?: 'inline' | 'footer';
  /** Optional additional CSS class */
  className?: string;
}

function getAcknowledged(): boolean {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function setAcknowledged(): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
  } catch {
    // sessionStorage may be unavailable in some contexts
  }
}

/**
 * LegalDisclaimer — displays regulatory disclaimer text.
 *
 * Validates: Requirements 24.1, 24.2, 24.3
 *
 * - Displays in regulatory evaluation view, Immediate_Notification_Alert, and export footers.
 * - When `requireAcknowledgment` is true, shows a blocking overlay until the user
 *   confirms they have read the disclaimer (persisted per session via sessionStorage).
 */
export function LegalDisclaimer({
  requireAcknowledgment = false,
  variant = 'inline',
  className = '',
}: LegalDisclaimerProps) {
  const [acknowledged, setAcknowledgedState] = useState(getAcknowledged);

  const handleAcknowledge = useCallback(() => {
    setAcknowledged();
    setAcknowledgedState(true);
  }, []);

  // Blocking overlay when acknowledgment is required but not yet given
  if (requireAcknowledgment && !acknowledged) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-disclaimer-title"
      >
        <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-500" />
            <div>
              <h2
                id="legal-disclaimer-title"
                className="text-lg font-semibold text-gray-900"
              >
                Legal Disclaimer
              </h2>
              <p className="mt-2 text-sm text-gray-700 leading-relaxed">
                {DISCLAIMER_TEXT}
              </p>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={handleAcknowledge}>
              I understand and acknowledge
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Footer variant — compact text for exports
  if (variant === 'footer') {
    return (
      <div
        className={`border-t border-gray-200 pt-3 mt-4 ${className}`}
        role="contentinfo"
        aria-label="Legal disclaimer"
      >
        <p className="text-xs text-gray-500 italic">{DISCLAIMER_TEXT}</p>
      </div>
    );
  }

  // Inline variant — subtle container for regulatory views
  return (
    <div
      className={`rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ${className}`}
      role="note"
      aria-label="Legal disclaimer"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <p className="text-sm text-amber-800">{DISCLAIMER_TEXT}</p>
      </div>
    </div>
  );
}
