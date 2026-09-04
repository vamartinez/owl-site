import type { DownloadProgress } from './types';
import { calculateDownloadProgress } from './utils';

interface DownloadProgressBarProps {
  progress: DownloadProgress;
}

/**
 * Formats bytes into a human-readable string (KB, MB, GB).
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Formats milliseconds into a human-readable time remaining string.
 */
function formatTimeRemaining(ms: number): string {
  if (ms <= 0) {
    return 'Calculating...';
  }

  const seconds = Math.ceil(ms / 1000);

  if (seconds < 60) {
    return `About ${seconds} second${seconds !== 1 ? 's' : ''} remaining`;
  }

  const minutes = Math.ceil(seconds / 60);
  return `About ${minutes} minute${minutes !== 1 ? 's' : ''} remaining`;
}

export function DownloadProgressBar({ progress }: DownloadProgressBarProps) {
  if (progress.status === 'timeout') {
    return (
      <div className="w-full rounded-md bg-amber-50 border border-amber-200 p-3" role="alert">
        <p className="text-sm font-medium text-amber-800">Download timed out</p>
        <p className="text-xs text-amber-600 mt-1">
          The download did not complete within the allowed time.
        </p>
      </div>
    );
  }

  if (progress.status === 'failed') {
    return (
      <div className="w-full rounded-md bg-red-50 border border-red-200 p-3" role="alert">
        <p className="text-sm font-medium text-red-800">Download failed</p>
        {progress.errorMessage && (
          <p className="text-xs text-red-600 mt-1">{progress.errorMessage}</p>
        )}
      </div>
    );
  }

  if (progress.status === 'complete') {
    return (
      <div className="w-full rounded-md bg-green-50 border border-green-200 p-3" role="status">
        <p className="text-sm font-medium text-green-800">Download complete</p>
      </div>
    );
  }

  if (progress.status === 'initiating' || progress.status === 'packaging') {
    return (
      <div className="w-full space-y-2" role="status" aria-live="polite">
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-primary-600 rounded-full animate-pulse w-1/3" />
        </div>
        <p className="text-xs text-gray-600">Preparing download...</p>
      </div>
    );
  }

  // 'downloading' status — show progress bar with percentage and ETA
  const { percentage, estimatedRemainingMs } = calculateDownloadProgress(progress);
  const clampedPercentage = Math.min(100, Math.max(0, Math.round(percentage)));

  return (
    <div className="w-full space-y-2">
      <div
        role="progressbar"
        aria-valuenow={clampedPercentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Download progress"
        className="w-full h-2 bg-gray-200 rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-primary-600 rounded-full transition-all duration-200"
          style={{ width: `${clampedPercentage}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-600">
          {clampedPercentage}% · {formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.totalBytes)}
        </p>
        <p className="text-xs text-gray-500">
          {formatTimeRemaining(estimatedRemainingMs)}
        </p>
      </div>
    </div>
  );
}
