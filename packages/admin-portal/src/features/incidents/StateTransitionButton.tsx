import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useStateTransition } from './hooks/useStateTransition';
import { VALID_TRANSITIONS, TRANSITION_ACTION_LABELS, STATUS_LABELS } from './constants';
import type { IncidentStatus } from './types';
import type { ApiClientError } from '@/services/api-client';

interface StateTransitionButtonProps {
  incidentId: string;
  currentStatus: IncidentStatus;
  onTransitionSuccess?: (newStatus: IncidentStatus) => void;
}

interface ToastState {
  visible: boolean;
  message: string;
  validTransitions: string[];
}

/**
 * Dropdown + button for transitioning an incident's state.
 * Shows valid transitions from the current state and handles 422 errors
 * by displaying a toast with the list of valid transitions.
 *
 * Requirements: 5.2, 5.3, 5.4
 */
export function StateTransitionButton({
  incidentId,
  currentStatus,
  onTransitionSuccess,
}: StateTransitionButtonProps) {
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    validTransitions: [],
  });

  const mutation = useStateTransition();

  const validTargets = VALID_TRANSITIONS[currentStatus] ?? [];

  const options = validTargets.map((status) => ({
    value: status,
    label: TRANSITION_ACTION_LABELS[status],
  }));

  const dismissToast = useCallback(() => {
    setToast({ visible: false, message: '', validTransitions: [] });
  }, []);

  const handleTransition = useCallback(() => {
    if (!selectedStatus) return;

    mutation.mutate(
      { incidentId, status: selectedStatus as IncidentStatus },
      {
        onSuccess: () => {
          setSelectedStatus('');
          onTransitionSuccess?.(selectedStatus as IncidentStatus);
        },
        onError: (error: ApiClientError) => {
          if (error.status === 422) {
            // Extract valid transitions from error details if available
            const details = error.details;
            const serverValidTransitions =
              (details?.validTransitions as string[] | undefined) ??
              validTargets.map((s) => STATUS_LABELS[s]);

            const transitionLabels = serverValidTransitions.map(
              (t) => STATUS_LABELS[t as IncidentStatus] ?? t
            );

            setToast({
              visible: true,
              message: 'Invalid state transition. Valid transitions from current state:',
              validTransitions: transitionLabels,
            });

            // Auto-dismiss after 6 seconds
            setTimeout(dismissToast, 6000);
          }
        },
      }
    );
  }, [incidentId, selectedStatus, mutation, validTargets, onTransitionSuccess, dismissToast]);

  // No transitions available from this state
  if (validTargets.length === 0) {
    return null;
  }

  return (
    <div className="flex items-end gap-2">
      <Select
        label="Transition to"
        options={options}
        placeholder="Select new state"
        value={selectedStatus}
        onChange={(e) => setSelectedStatus(e.target.value)}
        disabled={mutation.isPending}
        aria-label="Select state transition"
      />
      <Button
        variant="primary"
        size="md"
        onClick={handleTransition}
        disabled={!selectedStatus || mutation.isPending}
      >
        {mutation.isPending ? 'Transitioning...' : 'Apply'}
      </Button>

      {toast.visible && (
        <div
          className="fixed top-4 right-4 z-50 max-w-md w-full bg-amber-50 border border-amber-200 rounded-lg shadow-lg p-4 animate-in slide-in-from-top"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800">{toast.message}</p>
              <ul className="mt-1 list-disc list-inside text-sm text-amber-700">
                {toast.validTransitions.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <button
              onClick={dismissToast}
              className="p-1 hover:bg-amber-100 rounded shrink-0"
              aria-label="Dismiss notification"
            >
              <span className="text-amber-600 text-sm font-bold">✕</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
