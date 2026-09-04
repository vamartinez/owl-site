import { CheckCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import type { UploadStage } from './hooks/useUploadAndAnalyze';

/**
 * Step-progress indicator for the Safety AI upload → analyze pipeline.
 *
 * Reuses the sequential-stage visual pattern established by
 * report-validation's ValidationProgress component (submit → async AI
 * processing → poll/display structured result), adapted to the four
 * concrete steps of the detection pipeline.
 */

interface DetectionProgressProps {
  /** Current pipeline stage from useUploadAndAnalyze */
  stage: UploadStage;
}

type StageStatus = 'completed' | 'active' | 'pending';

interface StageConfig {
  /** Ordered stage identifiers this step maps to */
  keys: UploadStage[];
  label: string;
}

const STAGES: StageConfig[] = [
  { keys: ['creating_inspection'], label: 'Creating Inspection' },
  { keys: ['uploading_media'], label: 'Uploading Photo' },
  { keys: ['triggering_analysis'], label: 'Starting AI Analysis' },
  { keys: ['analyzing'], label: 'Analyzing for Hazards' },
];

const ORDER: UploadStage[] = [
  'idle',
  'creating_inspection',
  'uploading_media',
  'triggering_analysis',
  'analyzing',
];

function activeIndex(stage: UploadStage): number {
  const pos = ORDER.indexOf(stage);
  // Map the linear stage position onto the four visual steps.
  // idle → -1 (nothing active); creating→0; uploading→1; triggering→2; analyzing→3
  return pos - 1;
}

export function DetectionProgress({ stage }: DetectionProgressProps) {
  const current = activeIndex(stage);

  const getStatus = (index: number): StageStatus => {
    if (index < current) return 'completed';
    if (index === current) return 'active';
    return 'pending';
  };

  const isAnalyzing = stage === 'analyzing';

  return (
    <Card>
      <CardHeader
        title="AI Analysis in Progress"
        description={
          isAnalyzing
            ? 'Your photo is being analyzed for safety hazards. Findings will appear below when ready.'
            : 'Submitting your photo to the Safety AI pipeline...'
        }
      />
      <CardContent>
        <div
          className="space-y-0"
          role="progressbar"
          aria-valuenow={Math.max(current + 1, 1)}
          aria-valuemin={1}
          aria-valuemax={STAGES.length}
        >
          {STAGES.map((s, index) => {
            const status = getStatus(index);
            const isLast = index === STAGES.length - 1;
            return (
              <div key={s.label} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <StageIcon status={status} />
                  {!isLast && (
                    <div
                      className={`w-0.5 h-6 mt-1 ${
                        status === 'completed' ? 'bg-primary-500' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>
                <div className="pt-0.5">
                  <span
                    className={`text-sm ${
                      status === 'completed'
                        ? 'text-gray-500 line-through'
                        : status === 'active'
                          ? 'text-primary-700 font-medium'
                          : 'text-gray-400'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function StageIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case 'completed':
      return (
        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary-100">
          <CheckCircle className="text-primary-600" size={14} />
        </div>
      );
    case 'active':
      return (
        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary-100 animate-pulse">
          <Loader2 className="text-primary-600 animate-spin" size={14} />
        </div>
      );
    case 'pending':
      return (
        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gray-100">
          <div className="h-2 w-2 rounded-full bg-gray-300" />
        </div>
      );
  }
}

export default DetectionProgress;
