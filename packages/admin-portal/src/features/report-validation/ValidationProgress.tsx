import { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle, Clock, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getEstimatedTimeSeconds } from './utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidationStage =
  | 'document_extraction'
  | 'knowledge_base_query'
  | 'compliance_analysis'
  | 'result_generation';

type StageStatus = 'completed' | 'active' | 'pending';

interface StageConfig {
  id: ValidationStage;
  label: string;
}

interface ValidationProgressProps {
  /** ISO 8601 timestamp of when the validation request was initiated */
  requestedAt: string;
  /** Number of pages in the document (used for estimated time) */
  pageCount?: number;
  /** Current active stage (if known from backend) */
  currentStage?: ValidationStage;
  /** Called when user clicks "Retry Validation" after timeout */
  onRetry?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES: StageConfig[] = [
  { id: 'document_extraction', label: 'Document Extraction' },
  { id: 'knowledge_base_query', label: 'Knowledge Base Query' },
  { id: 'compliance_analysis', label: 'Compliance Analysis' },
  { id: 'result_generation', label: 'Result Generation' },
];

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Estimates which stage should be active based on elapsed time and estimated total.
 * Divides the estimated time evenly across 4 stages.
 */
function estimateActiveStageIndex(elapsedSeconds: number, estimatedTotalSeconds: number): number {
  const stageCount = STAGES.length;
  const stageDuration = estimatedTotalSeconds / stageCount;
  const index = Math.floor(elapsedSeconds / stageDuration);
  return Math.min(index, stageCount - 1);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Animated step-progress indicator for validation processing.
 * Shows 4 sequential stages with elapsed time and estimated total time.
 * Handles 5-minute timeout with retry action.
 * Restores progress state when user navigates away and returns.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */
export function ValidationProgress({
  requestedAt,
  pageCount = 1,
  currentStage,
  onRetry,
}: ValidationProgressProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const estimatedTime = getEstimatedTimeSeconds(pageCount);

  // Calculate elapsed time from requestedAt (supports restoration on navigation)
  const getElapsedFromRequest = useCallback((): number => {
    const requestTime = new Date(requestedAt).getTime();
    const now = Date.now();
    return Math.max(0, Math.floor((now - requestTime) / 1000));
  }, [requestedAt]);

  // Initialize elapsed time and start counter
  useEffect(() => {
    // Restore elapsed time from requestedAt timestamp (Req 10.6)
    const initialElapsed = getElapsedFromRequest();
    setElapsedSeconds(initialElapsed);

    // Check if already timed out
    if (initialElapsed * 1000 >= TIMEOUT_MS) {
      setIsTimedOut(true);
      return;
    }

    // Update elapsed time every second
    intervalRef.current = setInterval(() => {
      const elapsed = getElapsedFromRequest();
      setElapsedSeconds(elapsed);

      // Check for timeout (Req 10.5)
      if (elapsed * 1000 >= TIMEOUT_MS) {
        setIsTimedOut(true);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [getElapsedFromRequest]);

  // Determine active stage index
  const activeStageIndex = currentStage
    ? STAGES.findIndex((s) => s.id === currentStage)
    : estimateActiveStageIndex(elapsedSeconds, estimatedTime);

  // Get stage status
  const getStageStatus = (index: number): StageStatus => {
    if (index < activeStageIndex) return 'completed';
    if (index === activeStageIndex) return 'active';
    return 'pending';
  };

  // ─── Timeout State ──────────────────────────────────────────────────────

  if (isTimedOut) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <div className="flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100 mb-4">
            <AlertTriangle className="text-yellow-600" size={24} />
          </div>
          <p className="text-sm font-medium text-gray-900 mb-1">
            Validation Timed Out
          </p>
          <p className="text-xs text-gray-500 text-center mb-4 max-w-sm">
            Validation could not be completed within the expected time. You may retry the validation request.
          </p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw size={14} />
              Retry Validation
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // ─── Progress State ─────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader
        title="Validation in Progress"
        description={`Estimated time: ~${estimatedTime}s`}
      />
      <CardContent>
        {/* Step Progress Indicator */}
        <div className="relative" role="progressbar" aria-valuenow={activeStageIndex + 1} aria-valuemin={1} aria-valuemax={4}>
          <div className="space-y-0">
            {STAGES.map((stage, index) => {
              const status = getStageStatus(index);
              const isLast = index === STAGES.length - 1;

              return (
                <StageStep
                  key={stage.id}
                  label={stage.label}
                  status={status}
                  isLast={isLast}
                />
              );
            })}
          </div>
        </div>

        {/* Elapsed Time Counter */}
        <div className="mt-6 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock size={14} className="text-gray-400" />
              <span>Elapsed: <span className="font-medium text-gray-900">{formatElapsedTime(elapsedSeconds)}</span></span>
            </div>
            <span className="text-xs text-gray-500">
              Est. {estimatedTime}s total
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Stage Step ───────────────────────────────────────────────────────────────

interface StageStepProps {
  label: string;
  status: StageStatus;
  isLast: boolean;
}

function StageStep({ label, status, isLast }: StageStepProps) {
  return (
    <div className="flex items-start gap-3">
      {/* Icon + connector line */}
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

      {/* Label */}
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
          {label}
        </span>
      </div>
    </div>
  );
}

// ─── Stage Icon ───────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsedTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export default ValidationProgress;
