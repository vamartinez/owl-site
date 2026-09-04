import { useState, useEffect, useCallback } from 'react';
import { Search, FileText, Calendar, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { Pagination } from '@/components/data/Pagination';
import { useLinkableResponses, useLinkDocument } from './hooks/useLinkedDocuments';
import type {
  DocumentCategory,
  CreateLinkRequest,
  LinkableResponse,
} from './types';
import { DOCUMENT_CATEGORY_LABELS } from './types';

// ─── Props ───────────────────────────────────────────────────────────────────

interface LinkFormModalProps {
  incidentId: string;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 400;

const CATEGORY_OPTIONS = Object.entries(DOCUMENT_CATEGORY_LABELS).map(
  ([value, label]) => ({ value, label })
);

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Modal for searching and linking form responses to an incident.
 * Includes search with debounce, date range filters, paginated results,
 * category selection, and conditional custom description.
 *
 * Requirements: 1.1, 1.5, 2.2, 2.3, 6.1, 6.2, 6.3, 6.4
 */
export function LinkFormModal({ incidentId, isOpen, onClose }: LinkFormModalProps) {
  // ── Search & Filters ──
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  // ── Selection & Link Form ──
  const [selectedResponse, setSelectedResponse] = useState<LinkableResponse | null>(null);
  const [category, setCategory] = useState<DocumentCategory | ''>('');
  const [customDescription, setCustomDescription] = useState('');
  const [contextNote, setContextNote] = useState('');

  // ── Validation errors ──
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // ── Toast state (for 409 duplicate) ──
  const [toastError, setToastError] = useState<string | null>(null);

  // ── Debounce search input ──
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Reset state when modal closes ──
  useEffect(() => {
    if (!isOpen) {
      setSearchInput('');
      setDebouncedSearch('');
      setDateFrom('');
      setDateTo('');
      setPage(1);
      setSelectedResponse(null);
      setCategory('');
      setCustomDescription('');
      setContextNote('');
      setValidationErrors({});
      setToastError(null);
    }
  }, [isOpen]);

  // ── Queries ──
  const {
    data: linkableData,
    isLoading: isSearching,
    error: searchError,
  } = useLinkableResponses(isOpen ? incidentId : undefined, {
    search: debouncedSearch || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
  });

  const linkMutation = useLinkDocument(incidentId);

  // ── Derived values ──
  const totalPages = linkableData
    ? Math.ceil(linkableData.total_count / linkableData.page_size)
    : 0;

  // ── Validation ──
  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};

    if (!category) {
      errors.category = 'Selecciona una categoría de documento';
    }

    if (category === 'otro') {
      if (!customDescription.trim()) {
        errors.customDescription = 'La descripción es obligatoria para la categoría "Otro"';
      } else if (customDescription.trim().length < 5) {
        errors.customDescription = 'La descripción debe tener al menos 5 caracteres';
      } else if (customDescription.trim().length > 100) {
        errors.customDescription = 'La descripción no puede exceder 100 caracteres';
      }
    }

    if (contextNote.length > 500) {
      errors.contextNote = 'La nota no puede exceder 500 caracteres';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [category, customDescription, contextNote]);

  // ── Submit handler ──
  const handleConfirmLink = useCallback(() => {
    if (!selectedResponse) return;
    if (!validate()) return;

    const payload: CreateLinkRequest = {
      response_id: selectedResponse.response_id,
      form_id: selectedResponse.form_id,
      document_category: category as DocumentCategory,
    };

    if (category === 'otro') {
      payload.custom_category_description = customDescription.trim();
    }

    if (contextNote.trim()) {
      payload.context_note = contextNote.trim();
    }

    linkMutation.mutate(payload, {
      onSuccess: () => {
        onClose();
      },
      onError: (error) => {
        if (error.status === 409) {
          setToastError('Este documento ya está vinculado a este incidente');
          setTimeout(() => setToastError(null), 5000);
        }
        // Other errors are shown inline via linkMutation.error
      },
    });
  }, [selectedResponse, validate, category, customDescription, contextNote, linkMutation, onClose]);

  // ── Date filter handler (resets page) ──
  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    setPage(1);
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    setPage(1);
  };

  // ── Select response handler ──
  const handleSelectResponse = (response: LinkableResponse) => {
    setSelectedResponse(response);
    setValidationErrors({});
  };

  // ── Back to search ──
  const handleBackToSearch = () => {
    setSelectedResponse(null);
    setCategory('');
    setCustomDescription('');
    setContextNote('');
    setValidationErrors({});
  };

  return (
    <>
      <Modal open={isOpen} onClose={onClose} title="Vincular Documento" size="lg">
        {!selectedResponse ? (
          // ── STEP 1: Search & Select ──
          <div className="space-y-4">
            {/* Search input */}
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar por nombre, folio o usuario..."
                className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                aria-label="Buscar formularios"
              />
            </div>

            {/* Date range filters */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  <Calendar size={12} className="inline mr-1" />
                  Desde
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => handleDateFromChange(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                  aria-label="Fecha desde"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  <Calendar size={12} className="inline mr-1" />
                  Hasta
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => handleDateToChange(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                  aria-label="Fecha hasta"
                />
              </div>
            </div>

            {/* Results */}
            <div className="min-h-[200px]">
              {isSearching && (
                <div className="flex items-center justify-center py-8 text-gray-500">
                  <Loader2 size={20} className="animate-spin mr-2" />
                  <span className="text-sm">Buscando formularios...</span>
                </div>
              )}

              {searchError && (
                <p className="text-sm text-red-600 py-4 text-center">
                  Error al buscar formularios. Intenta de nuevo.
                </p>
              )}

              {!isSearching && !searchError && linkableData && (
                <>
                  {linkableData.responses.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                      <FileText size={32} className="mb-2 opacity-50" />
                      <p className="text-sm">No se encontraron formularios</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md overflow-hidden">
                      {linkableData.responses.map((response) => (
                        <li key={response.response_id}>
                          <button
                            type="button"
                            onClick={() => handleSelectResponse(response)}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors focus:outline-none focus:bg-primary-50"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-900">
                                {response.form_name}
                              </span>
                              <span className="text-xs text-gray-500 font-mono">
                                {response.folio}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                              <span>
                                {new Date(response.submitted_at).toLocaleDateString('es-MX', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </span>
                              <span>•</span>
                              <span>{response.submitted_by_name}</span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="mt-3">
                      <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          // ── STEP 2: Configure Link ──
          <div className="space-y-4">
            {/* Selected response summary */}
            <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  {selectedResponse.form_name}
                </span>
                <span className="text-xs text-gray-500 font-mono">
                  {selectedResponse.folio}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                <span>
                  {new Date(selectedResponse.submitted_at).toLocaleDateString('es-MX', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                <span>•</span>
                <span>{selectedResponse.submitted_by_name}</span>
              </div>
              <button
                type="button"
                onClick={handleBackToSearch}
                className="mt-2 text-xs text-primary-600 hover:text-primary-700 hover:underline"
              >
                ← Cambiar selección
              </button>
            </div>

            {/* Category selector */}
            <Select
              label="Categoría de documento *"
              placeholder="Selecciona una categoría"
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as DocumentCategory | '');
                setValidationErrors((prev) => ({ ...prev, category: '' }));
              }}
              error={validationErrors.category}
            />

            {/* Conditional custom description for "otro" */}
            {category === 'otro' && (
              <Input
                label="Descripción de categoría *"
                value={customDescription}
                onChange={(e) => {
                  setCustomDescription(e.target.value);
                  setValidationErrors((prev) => ({ ...prev, customDescription: '' }));
                }}
                placeholder="Describe el tipo de documento (5-100 caracteres)"
                error={validationErrors.customDescription}
                helperText={`${customDescription.length}/100 caracteres`}
                maxLength={100}
              />
            )}

            {/* Context note */}
            <div className="space-y-1">
              <label
                htmlFor="context-note"
                className="block text-sm font-medium text-gray-700"
              >
                Nota de contexto (opcional)
              </label>
              <textarea
                id="context-note"
                value={contextNote}
                onChange={(e) => {
                  setContextNote(e.target.value);
                  setValidationErrors((prev) => ({ ...prev, contextNote: '' }));
                }}
                placeholder="Describe la relevancia de este documento para el incidente..."
                rows={3}
                maxLength={500}
                className={`
                  block w-full rounded-md border px-3 py-2 text-sm shadow-sm
                  focus:outline-none focus:ring-1
                  ${validationErrors.contextNote
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                  }
                `}
                aria-invalid={!!validationErrors.contextNote}
                aria-describedby={validationErrors.contextNote ? 'context-note-error' : 'context-note-helper'}
              />
              {validationErrors.contextNote ? (
                <p id="context-note-error" className="text-xs text-red-600" role="alert">
                  {validationErrors.contextNote}
                </p>
              ) : (
                <p id="context-note-helper" className="text-xs text-gray-500">
                  {contextNote.length}/500 caracteres
                </p>
              )}
            </div>

            {/* Mutation error (non-409) */}
            {linkMutation.error && linkMutation.error.status !== 409 && (
              <ErrorDisplay
                error={linkMutation.error}
                variant="banner"
                title="Error al vincular documento"
              />
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                onClick={handleConfirmLink}
                disabled={linkMutation.isPending}
              >
                {linkMutation.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Vinculando...
                  </>
                ) : (
                  'Confirmar vinculación'
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Toast for 409 duplicate error */}
      {toastError && (
        <ErrorDisplay
          error={toastError}
          variant="toast"
          title="Documento duplicado"
          onDismiss={() => setToastError(null)}
        />
      )}
    </>
  );
}
