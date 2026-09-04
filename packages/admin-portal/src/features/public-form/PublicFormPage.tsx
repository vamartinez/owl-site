import { useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, AlertTriangle, FileX } from 'lucide-react';
import { PublicFormRenderer, useHoneypot, type FormValues, type FormErrors } from './PublicFormRenderer';
import { PublicFormSuccess } from './PublicFormSuccess';
import { PublicFormProvider, type PublicFormContextValue } from './PublicFormContext';
import { useFormValidation } from './validation';
import type { FieldConfig, FieldValidationError } from './validation';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export interface PublicFormField {
  field_id: string;
  type: string;
  label: string;
  required: boolean;
  order: number;
  placeholder?: string;
  help_text?: string;
  options?: { option_id: string; label: string }[];
  validation?: Record<string, unknown>;
}

export interface PublicFormData {
  name: string;
  description?: string;
  fields: PublicFormField[];
}

export class PublicApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(`API Error [${status}]: ${code}`);
    this.name = 'PublicApiError';
  }
}

async function fetchPublicForm(token: string): Promise<PublicFormData> {
  const response = await fetch(`${API_BASE_URL}/public/forms/${token}`, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try {
      const text = await response.text();
      body = JSON.parse(text);
    } catch {
      body = { code: 'UNKNOWN_ERROR' };
    }
    throw new PublicApiError(
      response.status,
      (body.code as string) || 'UNKNOWN_ERROR',
      body.details as Record<string, unknown> | undefined
    );
  }

  const data = await response.json();
  return data.form;
}

export function usePublicForm(token: string | undefined) {
  return useQuery<PublicFormData, PublicApiError>({
    queryKey: ['public-form', token],
    queryFn: () => fetchPublicForm(token!),
    enabled: !!token,
    retry: (failureCount, error) => {
      // Don't retry on 404 or 410 — these are definitive responses
      if (error.status === 404 || error.status === 410) return false;
      return failureCount < 2;
    },
  });
}

// ─── Submission API ───────────────────────────────────────────────────────────

interface SubmitFormResponseResult {
  folio: string;
  response_id: string;
}

interface SubmitFormResponseError {
  code: string;
  message?: string;
  details?: {
    errors?: Array<{ field_id: string; field_label?: string; message: string }>;
    [key: string]: unknown;
  };
}

/**
 * Submits form data to POST /public/forms/{token}/responses.
 * Retries up to 3 times on network/server errors with exponential backoff.
 *
 * Requirements: 11.1, 11.4, 11.8, 11.9
 */
export async function submitFormResponse(
  token: string,
  answers: Record<string, unknown>,
  options?: { maxRetries?: number }
): Promise<SubmitFormResponseResult> {
  const maxRetries = options?.maxRetries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}/public/forms/${token}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });

      if (response.ok) {
        return response.json();
      }

      // Parse error response
      let body: SubmitFormResponseError = { code: 'UNKNOWN_ERROR' };
      try {
        const text = await response.text();
        body = JSON.parse(text);
      } catch {
        body = { code: 'UNKNOWN_ERROR' };
      }

      // Don't retry on client errors (4xx) — these are definitive
      if (response.status >= 400 && response.status < 500) {
        throw new PublicApiError(
          response.status,
          body.code || 'UNKNOWN_ERROR',
          body.details as Record<string, unknown> | undefined
        );
      }

      // Server error (5xx) — retry with backoff
      lastError = new PublicApiError(
        response.status,
        body.code || 'SERVER_ERROR',
        body.details as Record<string, unknown> | undefined
      );
    } catch (error) {
      // If it's already a PublicApiError with a 4xx status, don't retry
      if (error instanceof PublicApiError && error.status >= 400 && error.status < 500) {
        throw error;
      }

      // Network error or server error — retry
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    // Wait before retrying (exponential backoff: 1s, 2s, 4s)
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // All retries exhausted
  throw lastError ?? new Error('Error al enviar el formulario');
}

// ─── UI States ────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mb-4" />
      <p className="text-sm text-gray-500">Cargando formulario...</p>
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="flex items-center justify-center h-14 w-14 rounded-full bg-gray-100 mb-4">
        <FileX className="text-gray-400" size={28} />
      </div>
      <h1 className="text-lg font-semibold text-gray-900 mb-2">
        Formulario no encontrado
      </h1>
      <p className="text-sm text-gray-500 max-w-sm">
        El enlace que seguiste no corresponde a ningún formulario disponible.
        Verifica la URL e intenta de nuevo.
      </p>
    </div>
  );
}

function GoneState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="flex items-center justify-center h-14 w-14 rounded-full bg-amber-50 mb-4">
        <AlertTriangle className="text-amber-500" size={28} />
      </div>
      <h1 className="text-lg font-semibold text-gray-900 mb-2">
        Formulario no disponible
      </h1>
      <p className="text-sm text-gray-500 max-w-sm">
        Este formulario ya no está disponible para recibir respuestas.
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="flex items-center justify-center h-14 w-14 rounded-full bg-red-50 mb-4">
        <AlertTriangle className="text-red-500" size={28} />
      </div>
      <h1 className="text-lg font-semibold text-gray-900 mb-2">
        Error al cargar el formulario
      </h1>
      <p className="text-sm text-gray-500 max-w-sm mb-4">
        No se pudo cargar el formulario. Verifica tu conexión a internet e
        intenta de nuevo.
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
      >
        <RefreshCw size={16} />
        Reintentar
      </button>
    </div>
  );
}

// ─── Form Content with Submission Logic ───────────────────────────────────────

function PublicFormContent({ form, token }: { form: PublicFormData; token: string }) {
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isFormGone, setIsFormGone] = useState(false);
  const [successFolio, setSuccessFolio] = useState<string | null>(null);

  // Honeypot for bot protection
  const { honeypotRef, isBot } = useHoneypot();

  // File key management for carga_archivo fields
  const fileKeysRef = useRef<Record<string, string | null>>({});

  const setFileKey = useCallback((fieldId: string, fileKey: string | null) => {
    if (fileKey) {
      fileKeysRef.current[fieldId] = fileKey;
    } else {
      delete fileKeysRef.current[fieldId];
    }
  }, []);

  const getFileKey = useCallback((fieldId: string): string | null => {
    return fileKeysRef.current[fieldId] ?? null;
  }, []);

  const formContextValue: PublicFormContextValue = {
    token,
    setFileKey,
    getFileKey,
  };

  // Convert PublicFormField[] to FieldConfig[] for the validation hook
  const fieldConfigs: FieldConfig[] = form.fields.map((f) => ({
    field_id: f.field_id,
    type: f.type as FieldConfig['type'],
    label: f.label,
    required: f.required,
    order: f.order,
    placeholder: f.placeholder,
    help_text: f.help_text,
    options: f.options,
    validation: f.validation as FieldConfig['validation'],
  }));

  const {
    validateOnBlur,
    validateOnSubmit,
    getErrorsForRenderer,
    clearFieldErrors,
    setServerErrors,
    clearErrors,
  } = useFormValidation(fieldConfigs);

  // Track the latest errors from the renderer
  const rendererErrorsRef = useRef<FormErrors>({});

  const updateRendererErrors = useCallback(() => {
    const newErrors = getErrorsForRenderer();
    rendererErrorsRef.current = newErrors;
    setErrors(newErrors);
  }, [getErrorsForRenderer]);

  const handleFieldChange = useCallback(
    (fieldId: string, value: unknown) => {
      setValues((prev) => ({ ...prev, [fieldId]: value }));
      // Clear error on change
      clearFieldErrors(fieldId);
      setErrors((prev) => {
        if (prev[fieldId]) {
          const next = { ...prev };
          delete next[fieldId];
          return next;
        }
        return prev;
      });
      // Clear submission error when user makes changes
      setSubmissionError(null);
    },
    [clearFieldErrors]
  );

  const handleFieldBlur = useCallback(
    (fieldId: string) => {
      const value = values[fieldId];
      validateOnBlur(fieldId, value);
      // Update renderer errors after validation
      setTimeout(() => updateRendererErrors(), 0);
    },
    [values, validateOnBlur, updateRendererErrors]
  );

  const handleSubmit = useCallback(async () => {
    // Clear previous submission error
    setSubmissionError(null);

    // Honeypot check — if filled, silently reject by showing fake success
    if (isBot()) {
      setIsSubmitting(true);
      // Simulate a brief delay to appear like a real submission
      await new Promise((resolve) => setTimeout(resolve, 800));
      setIsSubmitting(false);
      // Generate a fake folio to show a convincing success screen
      setSuccessFolio('XXXXXXXX');
      return;
    }

    // Run client-side validation first
    const validationResult = validateOnSubmit(values);
    updateRendererErrors();

    if (!validationResult.valid) {
      return;
    }

    // Submit to server
    setIsSubmitting(true);

    try {
      const result = await submitFormResponse(token, values);
      setSuccessFolio(result.folio);
    } catch (error) {
      if (error instanceof PublicApiError) {
        // Handle "formulario despublicado" — form was unpublished after page load
        if (error.status === 410 || error.code === 'GONE') {
          setIsFormGone(true);
          return;
        }

        // Handle server validation errors — display per-field errors preserving user input
        if (error.status === 400 && error.code === 'VALIDATION_ERROR' && error.details?.errors) {
          const serverErrors = error.details.errors as Array<{
            field_id: string;
            field_label?: string;
            message: string;
          }>;

          // Convert to FieldValidationError format and set via the hook
          const fieldValidationErrors: FieldValidationError[] = serverErrors.map((e) => ({
            field_id: e.field_id,
            field_label: e.field_label || e.field_id,
            message: e.message,
          }));

          setServerErrors(fieldValidationErrors);

          // Update renderer errors from the hook
          setTimeout(() => updateRendererErrors(), 0);
          return;
        }

        // Handle rate limiting
        if (error.status === 429) {
          setSubmissionError(
            'Demasiados envíos. Por favor espera unos minutos antes de intentar de nuevo.'
          );
          return;
        }

        // Other API errors
        setSubmissionError(
          error.details?.message
            ? String(error.details.message)
            : 'No se pudo enviar el formulario. Por favor intenta de nuevo.'
        );
      } else {
        // Network or unknown error (retries already exhausted)
        setSubmissionError(
          'No se pudo enviar el formulario. Verifica tu conexión a internet e intenta de nuevo.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [token, values, validateOnSubmit, updateRendererErrors, setServerErrors, isBot]);

  // Show "formulario despublicado" state
  if (isFormGone) {
    return <GoneState />;
  }

  // Show success confirmation with folio
  if (successFolio) {
    return <PublicFormSuccess formName={form.name} folio={successFolio} />;
  }

  return (
    <PublicFormProvider value={formContextValue}>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
            <h1 className="text-lg sm:text-xl font-semibold text-gray-900 mb-1">
              {form.name}
            </h1>
            {form.description && (
              <p className="text-sm text-gray-600 mb-6">{form.description}</p>
            )}
            {!form.description && <div className="mb-6" />}

            {submissionError && (
              <div
                className="mb-4 p-3 rounded-md bg-red-50 border border-red-200"
                role="alert"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={16} />
                  <p className="text-sm text-red-700">{submissionError}</p>
                </div>
              </div>
            )}

            <PublicFormRenderer
              form={form}
              values={values}
              errors={errors}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              honeypotRef={honeypotRef}
            />
          </div>
        </div>
      </div>
    </PublicFormProvider>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function PublicFormPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error, refetch } = usePublicForm(token);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <LoadingState />
      </div>
    );
  }

  if (error) {
    if (error.status === 404) {
      return (
        <div className="min-h-screen bg-gray-50">
          <NotFoundState />
        </div>
      );
    }

    if (error.status === 410) {
      return (
        <div className="min-h-screen bg-gray-50">
          <GoneState />
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-50">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data || !token) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NotFoundState />
      </div>
    );
  }

  // Form loaded successfully — render form content with submission logic
  return <PublicFormContent form={data} token={token} />;
}
