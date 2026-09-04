import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useSiteSearch } from '@/features/incidents/hooks/useSiteSearch';
import { useUploadAndAnalyze } from '@/features/safety-ai/hooks/useUploadAndAnalyze';
import { DetectionProgress } from '@/features/safety-ai/DetectionProgress';
import { Upload, Image as ImageIcon, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';

/**
 * Safety AI — Upload Evidence / New Scan.
 *
 * Submits a jobsite photo to the REAL detection/scene-understanding pipeline via
 * the AI Orchestration endpoints (POST /inspections → /inspections/{id}/media →
 * PUT to S3 → POST /inspections/{id}/analyze). See useUploadAndAnalyze for the
 * end-to-end orchestration.
 *
 * A site is REQUIRED because the detection pipeline captures site context on the
 * inspection and media metadata (Requirement 11 / backend Requirement 6.5).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */
export default function UploadEvidence() {
  const navigate = useNavigate();

  const [siteId, setSiteId] = useState<string | undefined>();
  const [siteQuery, setSiteQuery] = useState('');
  const [trade, setTrade] = useState('General');
  const [projectPhase, setProjectPhase] = useState('Construction');
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const siteSearch = useSiteSearch(siteQuery);
  const { stage, error, result, run, reset } = useUploadAndAnalyze();

  const isSubmitting =
    stage === 'creating_inspection' ||
    stage === 'uploading_media' ||
    stage === 'triggering_analysis';
  const isAnalyzing = stage === 'analyzing';

  const selectFile = useCallback((f: File | undefined) => {
    if (!f) return;
    if (!['image/jpeg', 'image/png'].includes(f.type)) {
      setValidationError('Only JPEG or PNG photos are supported.');
      return;
    }
    setValidationError(null);
    setFile(f);
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      selectFile(e.dataTransfer.files?.[0]);
    },
    [selectFile]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    selectFile(e.target.files?.[0]);
  };

  const canSubmit = Boolean(siteId && trade && projectPhase && file) && !isSubmitting && !isAnalyzing;

  const handleSubmit = () => {
    if (!siteId || !file || !trade || !projectPhase) {
      setValidationError('Select a site and a photo before submitting.');
      return;
    }
    setValidationError(null);
    void run({ siteId, trade, projectPhase, file });
  };

  const handleReset = () => {
    setFile(null);
    reset();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">New Safety Scan</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload or capture a jobsite photo and submit it for AI hazard analysis.
        </p>
      </div>

      <Card>
        <CardHeader title="Scan Details" />
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Combobox
              label="Site"
              value={siteId}
              onChange={setSiteId}
              onSearchChange={setSiteQuery}
              options={siteSearch.options}
              isLoading={siteSearch.isLoading}
              isError={siteSearch.isError}
              placeholder="Search for a site..."
              emptyMessage="No sites found"
              disabled={isSubmitting || isAnalyzing}
            />
            <Input
              label="Trade"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              placeholder="e.g. Electrical"
              disabled={isSubmitting || isAnalyzing}
            />
            <Input
              label="Project Phase"
              value={projectPhase}
              onChange={(e) => setProjectPhase(e.target.value)}
              placeholder="e.g. Framing"
              disabled={isSubmitting || isAnalyzing}
            />
          </div>

          {/* Drag-and-drop / browse / camera capture */}
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
            <p className="text-sm text-gray-600 mb-2">Drag and drop a photo here, or</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <label className="cursor-pointer">
                <span className="text-sm font-medium text-primary-600 hover:text-primary-700">
                  browse to select
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Select a photo"
                  disabled={isSubmitting || isAnalyzing}
                />
              </label>
              <span className="text-xs text-gray-400">or</span>
              {/* Camera capture — reuses the IncidentCreateForm "Take Photo" pattern */}
              <label
                htmlFor="safety-camera-capture"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 rounded-md cursor-pointer hover:bg-primary-100 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Take Photo
              </label>
              <input
                id="safety-camera-capture"
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={handleFileChange}
                aria-label="Capture photo from camera"
                disabled={isSubmitting || isAnalyzing}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              JPEG or PNG, minimum 640×480, up to 25 MB.
            </p>
          </div>

          {file && (
            <div className="mt-4 flex items-center gap-3">
              <div className="w-16 h-16 rounded border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
                <img
                  src={URL.createObjectURL(file)}
                  alt="Selected photo preview"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <ImageIcon size={14} className="text-blue-500" />
                <span>{file.name}</span>
                <span className="text-gray-400">({(file.size / 1024).toFixed(1)} KB)</span>
              </div>
            </div>
          )}

          {validationError && (
            <p className="mt-3 text-sm text-red-600">{validationError}</p>
          )}

          <div className="mt-4">
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {isSubmitting ? 'Submitting...' : 'Upload & Analyze'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Async progress — reuses the sequential-stage pattern from ValidationProgress */}
      {(isSubmitting || isAnalyzing) && <DetectionProgress stage={stage} />}

      {/* Result — direct the user to the findings list where detected hazards surface */}
      {isAnalyzing && result && (
        <Card>
          <CardContent className="py-6">
            <div className="flex items-start gap-3">
              <CheckCircle size={24} className="text-green-600 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-gray-900">Analysis started</p>
                <p className="text-sm text-gray-500">
                  Your photo was submitted successfully. Detected hazards will appear in the
                  findings list once the AI pipeline completes (usually within a minute).
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => navigate('/safety-ai')}>
                    View Findings
                    <ArrowRight size={14} />
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    Scan Another Photo
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {stage === 'error' && error && (
        <Card>
          <CardContent className="py-6">
            <div className="flex items-start gap-3">
              <AlertTriangle size={24} className="text-red-600 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-gray-900">Could not start analysis</p>
                <p className="text-sm text-gray-500">{error}</p>
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    Try Again
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
