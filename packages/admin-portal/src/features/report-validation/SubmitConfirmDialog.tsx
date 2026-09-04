import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface SubmitConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog shown when submitting a report with status "draft"
 * (i.e., without prior validation). Warns the user that the report has not
 * been validated for compliance and provides explicit confirm/cancel actions.
 *
 * Not shown when submitting a "validated" report — the caller should
 * proceed directly with submission in that case.
 *
 * Validates: Requirements 7.5, 7.6, 7.7
 */
export function SubmitConfirmDialog({ isOpen, onConfirm, onCancel }: SubmitConfirmDialogProps) {
  return (
    <Modal open={isOpen} onClose={onCancel} title="Submit Without Validation" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <AlertTriangle size={20} className="text-amber-500" />
          </div>
          <p className="text-sm text-gray-700">
            This report has not been validated for compliance. Submitting without
            validation means potential compliance issues may not have been
            identified.
          </p>
        </div>

        <p className="text-sm text-gray-600">
          Are you sure you want to submit this report without AI compliance
          validation?
        </p>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Confirm Submission
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default SubmitConfirmDialog;
