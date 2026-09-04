import { useState, useCallback } from 'react';
import { useApiMutation, useInvalidateQueries } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Download } from 'lucide-react';

interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: { row: number; message: string }[];
}

export default function BulkImport() {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const invalidate = useInvalidateQueries();

  const { mutate, isPending, data: result } = useApiMutation<ImportResult, FormData>(
    'post',
    '/workers/bulk-import',
    {
      onSuccess: () => {
        invalidate([['workers']]);
        setFile(null);
      },
    }
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = () => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    mutate(formData);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Bulk Import Workers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload a CSV or Excel file to register multiple workers at once
        </p>
      </div>

      <Card>
        <CardHeader
          title="Upload File"
          description="Supported formats: .csv, .xlsx"
          action={
            <Button variant="outline" size="sm">
              <Download size={16} />
              Download Template
            </Button>
          }
        />
        <CardContent>
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center transition-colors
              ${dragActive ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-gray-400'}
            `}
          >
            <Upload size={40} className="mx-auto text-gray-400 mb-4" />
            <p className="text-sm text-gray-600 mb-2">
              Drag and drop your file here, or
            </p>
            <label className="cursor-pointer">
              <span className="text-sm font-medium text-primary-600 hover:text-primary-700">
                browse to select
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Select file for bulk import"
              />
            </label>
          </div>

          {file && (
            <div className="mt-4 flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileSpreadsheet size={20} className="text-green-600" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
              <Button size="sm" onClick={handleUpload} disabled={isPending}>
                {isPending ? 'Importing...' : 'Start Import'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader title="Import Results" />
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold text-gray-900">{result.totalRows}</p>
                <p className="text-xs text-gray-500">Total Rows</p>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-700">{result.successCount}</p>
                <p className="text-xs text-green-600">Imported</p>
              </div>
              <div className="text-center p-3 bg-red-50 rounded-lg">
                <p className="text-2xl font-bold text-red-700">{result.errorCount}</p>
                <p className="text-xs text-red-600">Errors</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">Errors:</p>
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {result.errors.map((err) => (
                    <li key={err.row} className="flex items-start gap-2 text-sm">
                      <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                      <span className="text-gray-600">
                        Row {err.row}: {err.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.errorCount === 0 && (
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle size={16} />
                <span className="text-sm">All rows imported successfully</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
