import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useState } from 'react';

const IS_DEBUG = import.meta.env.DEV;

interface ErrorDisplayProps {
  error: Error | string | null;
  title?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  variant?: 'inline' | 'banner' | 'toast';
  debugInfo?: Record<string, unknown>;
}

export function ErrorDisplay({
  error,
  title,
  onRetry,
  onDismiss,
  variant = 'inline',
  debugInfo,
}: ErrorDisplayProps) {
  const [showDebug, setShowDebug] = useState(false);

  if (!error) return null;

  const message = typeof error === 'string' ? error : error.message;
  const stack = typeof error === 'object' ? error.stack : undefined;

  if (variant === 'toast') {
    return (
      <div className="fixed top-4 right-4 z-50 max-w-md w-full bg-red-50 border border-red-200 rounded-lg shadow-lg p-4 animate-in slide-in-from-top">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="flex-1 min-w-0">
            {title && <p className="text-sm font-medium text-red-800">{title}</p>}
            <p className="text-sm text-red-700 mt-0.5">{message}</p>
            {IS_DEBUG && debugInfo && (
              <DebugSection show={showDebug} onToggle={() => setShowDebug(!showDebug)} info={debugInfo} stack={stack} />
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onRetry && (
              <button onClick={onRetry} className="p-1 hover:bg-red-100 rounded" title="Reintentar">
                <RefreshCw size={14} className="text-red-600" />
              </button>
            )}
            {onDismiss && (
              <button onClick={onDismiss} className="p-1 hover:bg-red-100 rounded" title="Cerrar">
                <X size={14} className="text-red-600" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'banner') {
    return (
      <div className="w-full bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            {title && <p className="text-sm font-medium text-red-800">{title}</p>}
            <p className="text-sm text-red-700 mt-0.5">{message}</p>
            {IS_DEBUG && debugInfo && (
              <DebugSection show={showDebug} onToggle={() => setShowDebug(!showDebug)} info={debugInfo} stack={stack} />
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors"
              >
                Reintentar
              </button>
            )}
            {onDismiss && (
              <button onClick={onDismiss} className="p-1 hover:bg-red-100 rounded">
                <X size={14} className="text-red-600" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // inline variant
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
        <AlertTriangle className="text-red-500" size={24} />
      </div>
      {title && <h3 className="text-lg font-medium text-gray-900 mb-1">{title}</h3>}
      <p className="text-sm text-gray-600 max-w-md mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
        >
          <RefreshCw size={16} />
          Reintentar
        </button>
      )}
      {IS_DEBUG && debugInfo && (
        <DebugSection show={showDebug} onToggle={() => setShowDebug(!showDebug)} info={debugInfo} stack={stack} />
      )}
    </div>
  );
}

function DebugSection({
  show,
  onToggle,
  info,
  stack,
}: {
  show: boolean;
  onToggle: () => void;
  info: Record<string, unknown>;
  stack?: string;
}) {
  return (
    <div className="mt-2">
      <button
        onClick={onToggle}
        className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
      >
        {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {show ? 'Hide details' : 'View details (debug)'}
      </button>
      {show && (
        <pre className="mt-2 p-2 bg-red-900 text-red-100 text-xs rounded overflow-x-auto max-h-48 overflow-y-auto">
          {JSON.stringify(info, null, 2)}
          {stack && `\n\n--- Stack ---\n${stack}`}
        </pre>
      )}
    </div>
  );
}
