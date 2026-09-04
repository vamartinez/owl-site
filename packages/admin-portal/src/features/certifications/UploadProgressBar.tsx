interface UploadProgressBarProps {
  progress: number;
}

export function UploadProgressBar({ progress }: UploadProgressBarProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div className="w-full space-y-1">
      <div
        role="progressbar"
        aria-valuenow={clampedProgress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Upload progress"
        className="w-full h-2 bg-gray-200 rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-blue-600 rounded-full transition-all duration-200"
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
      <p className="text-xs text-gray-600 text-right">{clampedProgress}%</p>
    </div>
  );
}
