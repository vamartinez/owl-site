import { useState, useRef, useCallback } from 'react';
import { Upload, Trash2, FileText, AlertCircle } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useAuthStore } from '@/store/auth-store';
import { useKBDocuments, useCreateKBDocument, useDeleteKBDocument } from './hooks';
import { kbDocumentUploadSchema } from './schemas';
import type { KBContextDocument, KBDocumentCategory, KBSyncStatus } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<KBDocumentCategory, string> = {
  worksafebc: 'WorkSafeBC OHS Regulation',
  'bc-building-code': 'BC Building Code',
  'safety-standards': 'Construction Safety Standards',
  'canada-general': 'Canada General',
};

const CATEGORY_OPTIONS = [
  { value: 'worksafebc', label: 'WorkSafeBC OHS Regulation' },
  { value: 'bc-building-code', label: 'BC Building Code' },
  { value: 'safety-standards', label: 'Construction Safety Standards' },
  { value: 'canada-general', label: 'Canada General' },
];

const SYNC_STATUS_CONFIG: Record<KBSyncStatus, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  indexed: { label: 'Indexed', variant: 'success' },
  pending: { label: 'Pending', variant: 'warning' },
  error: { label: 'Error', variant: 'danger' },
};

const MAX_KB_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function KnowledgeBaseManager() {
  const role = useAuthStore((s) => s.role);
  const { data, isLoading, error, refetch } = useKBDocuments();
  const { createDocument, isLoading: isUploading, error: uploadError, uploadProgress, isUploading: isS3Uploading, reset: resetUpload } = useCreateKBDocument();
  const { deleteDocument, isLoading: isDeleting } = useDeleteKBDocument();

  const [showUploadForm, setShowUploadForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KBContextDocument | null>(null);

  // ─── Access Control ───────────────────────────────────────────────────────

  if (role !== 'tenant_admin' && role !== 'platform_admin') {
    return (
      <PageContainer title="Knowledge Base">
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <AlertCircle className="text-red-400 mb-4" size={48} />
          <h3 className="text-lg font-medium text-gray-900 mb-1">Access Denied</h3>
          <p className="text-sm text-gray-600">
            Only tenant administrators can manage Knowledge Base documents.
          </p>
        </div>
      </PageContainer>
    );
  }

  // ─── Error State ──────────────────────────────────────────────────────────

  if (error) {
    return (
      <PageContainer title="Knowledge Base">
        <ErrorDisplay
          error={error}
          title="Failed to load documents"
          onRetry={() => refetch()}
        />
      </PageContainer>
    );
  }

  const documents = data?.documents ?? [];

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleUploadSuccess = () => {
    setShowUploadForm(false);
    resetUpload();
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await deleteDocument(deleteTarget.document_id);
    setDeleteTarget(null);
  };

  return (
    <PageContainer
      title="Knowledge Base"
      description="Manage regulatory and standards documents used for AI compliance validation"
      actions={
        <Button onClick={() => setShowUploadForm(true)}>
          <Upload size={16} />
          Upload Document
        </Button>
      }
    >
      <div className="space-y-4">
        {!isLoading && documents.length === 0 ? (
          <EmptyState onUpload={() => setShowUploadForm(true)} />
        ) : (
          <DocumentList
            documents={documents}
            isLoading={isLoading}
            onDelete={setDeleteTarget}
          />
        )}
      </div>

      {/* Upload Form Modal */}
      <UploadFormModal
        open={showUploadForm}
        onClose={() => {
          setShowUploadForm(false);
          resetUpload();
        }}
        onUpload={createDocument}
        onSuccess={handleUploadSuccess}
        isUploading={isUploading || isS3Uploading}
        uploadProgress={uploadProgress}
        uploadError={uploadError}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Document"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to delete{' '}
            <span className="font-medium text-gray-900">{deleteTarget?.file_name}</span>?
            This will remove the document from the Knowledge Base and trigger a re-sync.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}

// ─── Document List ────────────────────────────────────────────────────────────

interface DocumentListProps {
  documents: KBContextDocument[];
  isLoading: boolean;
  onDelete: (doc: KBContextDocument) => void;
}

function DocumentList({ documents, isLoading, onDelete }: DocumentListProps) {
  if (isLoading) {
    return (
      <div className="text-sm text-gray-500 py-8 text-center">
        Loading documents...
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              File Name
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Category
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Upload Date
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Size
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Sync Status
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {documents.map((doc) => (
            <DocumentRow key={doc.document_id} document={doc} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Document Row ─────────────────────────────────────────────────────────────

interface DocumentRowProps {
  document: KBContextDocument;
  onDelete: (doc: KBContextDocument) => void;
}

function DocumentRow({ document, onDelete }: DocumentRowProps) {
  const syncConfig = SYNC_STATUS_CONFIG[document.sync_status];

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 text-sm text-gray-900">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-gray-400 flex-shrink-0" />
          <span className="truncate max-w-xs" title={document.file_name}>
            {document.file_name}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">
        {CATEGORY_LABELS[document.category]}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">
        {formatDate(document.uploaded_at)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">
        {formatFileSize(document.file_size)}
      </td>
      <td className="px-4 py-3">
        <Badge variant={syncConfig.variant}>
          {syncConfig.label}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(document)}
          aria-label={`Delete ${document.file_name}`}
        >
          <Trash2 size={14} className="text-red-500" />
        </Button>
      </td>
    </tr>
  );
}

// ─── Upload Form Modal ────────────────────────────────────────────────────────

interface UploadFormModalProps {
  open: boolean;
  onClose: () => void;
  onUpload: (params: { metadata: { file_name: string; file_size: number; mime_type: string; category: KBDocumentCategory }; file: File }) => Promise<void>;
  onSuccess: () => void;
  isUploading: boolean;
  uploadProgress: number;
  uploadError: string | null;
}

function UploadFormModal({
  open,
  onClose,
  onUpload,
  onSuccess,
  isUploading,
  uploadProgress,
  uploadError,
}: UploadFormModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState<KBDocumentCategory | ''>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = useCallback(() => {
    setSelectedFile(null);
    setCategory('');
    setValidationError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setValidationError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!selectedFile || !category) {
      setValidationError('Please select a file and category.');
      return;
    }

    // Client-side validation using Zod schema
    const result = kbDocumentUploadSchema.safeParse({
      document: selectedFile,
      category,
    });

    if (!result.success) {
      const firstError = result.error.errors[0]?.message ?? 'Invalid file';
      setValidationError(firstError);
      return;
    }

    try {
      await onUpload({
        metadata: {
          file_name: selectedFile.name,
          file_size: selectedFile.size,
          mime_type: selectedFile.type,
          category: category as KBDocumentCategory,
        },
        file: selectedFile,
      });
      resetForm();
      onSuccess();
    } catch {
      // Error is handled by the hook and displayed via uploadError
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const displayError = validationError || uploadError;

  return (
    <Modal open={open} onClose={handleClose} title="Upload Context Document">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* File Input */}
        <div className="space-y-1">
          <label htmlFor="kb-file-input" className="block text-sm font-medium text-gray-700">
            Document File
          </label>
          <input
            ref={fileInputRef}
            id="kb-file-input"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileChange}
            disabled={isUploading}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50"
          />
          <p className="text-xs text-gray-500">
            Accepted formats: PDF, .docx. Maximum size: 50 MB.
          </p>
        </div>

        {/* Category Selection */}
        <Select
          label="Category"
          options={CATEGORY_OPTIONS}
          placeholder="Select a category"
          value={category}
          onChange={(e) => setCategory(e.target.value as KBDocumentCategory | '')}
          disabled={isUploading}
        />

        {/* Error Display */}
        {displayError && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 text-red-700 text-sm" role="alert">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{displayError}</span>
          </div>
        )}

        {/* Upload Progress */}
        {isUploading && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-600">
              <span>Uploading...</span>
              <span>{Math.round(uploadProgress)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" type="button" onClick={handleClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button type="submit" disabled={isUploading || !selectedFile || !category}>
            {isUploading ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="flex items-center justify-center h-16 w-16 rounded-full bg-gray-100 mb-4">
        <FileText className="text-gray-400" size={32} />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-1">No context documents</h3>
      <p className="text-sm text-gray-600 max-w-sm mb-6">
        Upload regulatory and standards documents to build the Knowledge Base used for AI compliance validation.
      </p>
      <Button onClick={onUpload}>
        <Upload size={16} />
        Upload First Document
      </Button>
    </div>
  );
}

export default KnowledgeBaseManager;
