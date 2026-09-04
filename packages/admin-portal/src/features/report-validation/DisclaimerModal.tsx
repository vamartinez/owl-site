import { useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useDisclaimerAck } from './hooks/useDisclaimerAck';

const AI_DISCLAIMER_TEXT =
  'This AI-generated compliance analysis is provided as advisory support only. It does not constitute legal advice or guarantee regulatory compliance. Always consult with qualified professionals for final compliance determinations.';

interface DisclaimerModalProps {
  open: boolean;
  onAcknowledge: () => void;
  onCancel: () => void;
}

/**
 * DisclaimerModal displays the AI disclaimer text and requires explicit acknowledgment
 * before allowing a validation request to proceed.
 *
 * Show only on first validation request per authenticated session (uses useDisclaimerAck hook).
 * If user does not acknowledge: prevent validation request, keep modal displayed.
 * Provide "Cancel" action to dismiss without acknowledging (blocks validation).
 *
 * Validates: Requirements 12.1, 12.2, 12.3
 */
export function DisclaimerModal({ open, onAcknowledge, onCancel }: DisclaimerModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const { acknowledge } = useDisclaimerAck();

  const handleCheckboxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAcknowledged(e.target.checked);
  }, []);

  const handleAcknowledge = useCallback(() => {
    if (!acknowledged) return;
    acknowledge();
    onAcknowledge();
  }, [acknowledged, acknowledge, onAcknowledge]);

  const handleCancel = useCallback(() => {
    setAcknowledged(false);
    onCancel();
  }, [onCancel]);

  return (
    <Modal open={open} onClose={handleCancel} title="AI Validation Disclaimer" size="md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-md bg-amber-50 border border-amber-200">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
          <p className="text-sm text-gray-800 leading-relaxed">
            {AI_DISCLAIMER_TEXT}
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={handleCheckboxChange}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            aria-label="I acknowledge this disclaimer"
          />
          <span className="text-sm text-gray-700">
            I understand that this AI analysis is advisory only and does not constitute legal advice
            or guarantee regulatory compliance.
          </span>
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleAcknowledge}
            disabled={!acknowledged}
          >
            Acknowledge &amp; Continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
