/**
 * PublicFormSuccess — Confirmation screen shown after successful form submission.
 *
 * Displays a success message and the 8-character alphanumeric folio reference.
 *
 * Requirements: 11.1, 11.3
 */

import { CheckCircle } from 'lucide-react';

interface PublicFormSuccessProps {
  /** The form name to display in the confirmation */
  formName: string;
  /** The 8-character alphanumeric folio reference */
  folio: string;
}

export function PublicFormSuccess({ formName, folio }: PublicFormSuccessProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8 text-center">
          <div className="flex items-center justify-center h-16 w-16 rounded-full bg-green-50 mx-auto mb-4">
            <CheckCircle className="text-green-500" size={32} />
          </div>

          <h1 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">
            ¡Formulario enviado exitosamente!
          </h1>

          <p className="text-sm text-gray-600 mb-6">
            Tu respuesta al formulario <span className="font-medium">{formName}</span> ha sido
            registrada correctamente.
          </p>

          <div className="bg-gray-50 rounded-md border border-gray-200 p-4 mb-6">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              Folio de referencia
            </p>
            <p
              className="text-2xl font-mono font-bold text-gray-900 tracking-wider"
              aria-label={`Folio de referencia: ${folio}`}
            >
              {folio}
            </p>
          </div>

          <p className="text-xs text-gray-400">
            Guarda este folio como comprobante de tu envío.
          </p>
        </div>
      </div>
    </div>
  );
}
