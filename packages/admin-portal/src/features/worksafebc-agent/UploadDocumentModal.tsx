import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useCreateSession, useCategorizeSession } from './api';
import { useUploadToS3 } from '@/features/report-validation/hooks/useUploadToS3';
import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from './types';

const MAX_BYTES = 50 * 1024 * 1024;

interface Props {
  open: boolean;
  onClose: () => void;
  siteId: string;
  onCreated?: (sessionId: string) => void;
}

/**
 * Task 14.1 — Upload a PDF then pick its category. Client-side size/type hint;
 * server enforces the authoritative bounds. Two-step presigned upload, then
 * PATCH category to trigger the pipeline.
 */
export function UploadDocumentModal({ open, onClose, siteId, onCreated }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>('plan_seguridad');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'pick' | 'uploaded' | 'error'>('pick');
  const [message, setMessage] = useState<string | null>(null);

  const createSession = useCreateSession();
  const categorize = useCategorizeSession();
  const { upload, progress, isUploading } = useUploadToS3();

  const reset = () => {
    setFile(null);
    setCategory('plan_seguridad');
    setSessionId(null);
    setPhase('pick');
    setMessage(null);
  };

  const handleFile = (f: File | undefined) => {
    setMessage(null);
    if (!f) return;
    if (f.type !== 'application/pdf') {
      setMessage('El archivo debe ser un PDF.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setMessage('El archivo supera el límite de 50MB.');
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setMessage(null);
    try {
      const res = await createSession.mutateAsync({
        document_name: file.name,
        document_size_bytes: file.size,
        document_page_count: 0, // page count validated server-side after extraction
        site_id: siteId,
      });
      await upload(file, res.upload_url);
      setSessionId(res.session_id);
      setPhase('uploaded');
    } catch {
      setPhase('error');
      setMessage('Falló la carga del documento. Intenta de nuevo.');
    }
  };

  const handleCategorize = async () => {
    if (!sessionId) return;
    try {
      await categorize.mutateAsync({ sessionId, category });
      onCreated?.(sessionId);
      reset();
      onClose();
    } catch {
      setMessage('No se pudo categorizar la sesión.');
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Analizar documento WorkSafeBC" size="md">
      <div className="space-y-4">
        {phase === 'pick' && (
          <>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Documento PDF</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => handleFile(e.target.files?.[0])}
                className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-primary-700"
              />
            </label>
            {file && <p className="text-xs text-gray-500">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
            {isUploading && <p className="text-xs text-gray-500">Subiendo… {progress}%</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancelar</Button>
              <Button onClick={handleUpload} disabled={!file || isUploading || createSession.isPending}>
                {isUploading ? 'Subiendo…' : 'Subir'}
              </Button>
            </div>
          </>
        )}

        {phase === 'uploaded' && (
          <>
            <p className="text-sm text-gray-600">Documento subido. Selecciona la categoría para iniciar el análisis.</p>
            <Select
              label="Categoría del documento"
              value={category}
              onChange={(e) => setCategory(e.target.value as DocumentCategory)}
              options={Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cerrar</Button>
              <Button onClick={handleCategorize} disabled={categorize.isPending}>
                {categorize.isPending ? 'Iniciando…' : 'Iniciar análisis'}
              </Button>
            </div>
          </>
        )}

        {message && <p className="text-sm text-red-600" role="alert">{message}</p>}
      </div>
    </Modal>
  );
}
