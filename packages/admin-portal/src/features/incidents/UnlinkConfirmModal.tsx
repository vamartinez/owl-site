import { useState, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useUnlinkDocument } from './hooks/useLinkedDocuments';
import { DOCUMENT_CATEGORY_LABELS } from './types';
import type { LinkedDocument } from './types';

interface UnlinkConfirmModalProps {
  incidentId: string;
  document: LinkedDocument | null;
  isOpen: boolean;
  onClose: () => void;
}

const MIN_JUSTIFICATION_LENGTH = 10;

/**
 * Confirmation modal for unlinking a document from an incident.
 * Requires a justification (min 10 characters) before allowing the unlink operation.
 *
 * Requirements: 5.1, 5.2
 */
export function UnlinkConfirmModal({
  incidentId,
  document,
  isOpen,
  onClose,
}: UnlinkConfirmModalProps) {
  const [justification, setJustification] = useState('');
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: '',
  });

  const unlinkMutation = useUnlinkDocument(incidentId);

  const isValid = justification.trim().length >= MIN_JUSTIFICATION_LENGTH;

  const handleClose = useCallback(() => {
    setJustification('');
    setToast({ visible: false, message: '' });
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    if (!document || !isValid) return;

    unlinkMutation.mutate(
      { linkId: document.link_id, justification: justification.trim() },
      {
        onSuccess: () => {
          handleClose();
        },
        onError: (error) => {
          const message =
            error.message || 'Error al desvincular el documento. Intente nuevamente.';
          setToast({ visible: true, message });
          setTimeout(() => setToast({ visible: false, message: '' }), 6000);
        },
      }
    );
  }, [document, isValid, justification, unlinkMutation, handleClose]);

  if (!document) return null;

  return (
    <>
      <Modal open={isOpen} onClose={handleClose} title="Desvincular Documento" size="md">
        <div className="space-y-4">
          {/* Document summary */}
          <div className="rounded-md bg-gray-50 border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-900">{document.form_name}</p>
            <p className="text-sm text-gray-600 mt-1">
              Folio: <span className="font-medium">{document.folio}</span>
            </p>
            <p className="text-sm text-gray-600 mt-0.5">
              Categoría:{' '}
              <span className="font-medium">
                {DOCUMENT_CATEGORY_LABELS[document.document_category]}
              </span>
            </p>
          </div>

          {/* Justification field */}
          <div>
            <label
              htmlFor="unlink-justification"
              className="block text-sm font-medium text-gray-700"
            >
              Justificación
            </label>
            <textarea
              id="unlink-justification"
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explique por qué desea desvincular este documento..."
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 resize-y ${
                justification.length > 0 && !isValid ? 'border-red-300' : 'border-gray-300'
              }`}
              aria-invalid={justification.length > 0 && !isValid}
              aria-describedby="justification-hint"
              disabled={unlinkMutation.isPending}
            />
            <p
              id="justification-hint"
              className={`mt-1 text-xs ${
                justification.length > 0 && !isValid ? 'text-red-600' : 'text-gray-500'
              }`}
            >
              {justification.length > 0 && !isValid
                ? `Mínimo 10 caracteres (${justification.trim().length}/${MIN_JUSTIFICATION_LENGTH})`
                : `Mínimo 10 caracteres`}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={unlinkMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleSubmit}
              disabled={!isValid || unlinkMutation.isPending}
            >
              {unlinkMutation.isPending ? 'Desvinculando...' : 'Desvincular'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Error toast */}
      {toast.visible && (
        <div
          className="fixed top-4 right-4 z-50 max-w-md w-full bg-red-50 border border-red-200 rounded-lg shadow-lg p-4 animate-in slide-in-from-top"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-800">{toast.message}</p>
            </div>
            <button
              onClick={() => setToast({ visible: false, message: '' })}
              className="p-1 hover:bg-red-100 rounded shrink-0"
              aria-label="Dismiss notification"
            >
              <span className="text-red-600 text-sm font-bold">✕</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
