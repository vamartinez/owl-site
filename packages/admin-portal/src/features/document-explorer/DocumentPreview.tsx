import { useCallback, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useDocumentPreview } from './hooks/useDocumentPreview';
import { useDocumentDownload } from './hooks/useDocumentDownload';
import { useDocExplorerStore } from './store';
import { isPreviewable } from './utils';

interface DocumentPreviewProps {
  /** The mimeType of the document currently being previewed. */
  mimeType: string | undefined;
}

const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 800;
const DEFAULT_PANEL_WIDTH = 420;

/**
 * DocumentPreview renders a resizable side panel for previewing documents.
 *
 * - PDFs render via `<iframe>`
 * - Images (JPEG, PNG) render via `<img>`
 * - Non-previewable formats show a fallback with a download button
 * - Includes a close button (X) and loading state
 *
 * Requirements: 2.3, 2.4
 */
export function DocumentPreview({ mimeType }: DocumentPreviewProps) {
  const previewDocumentId = useDocExplorerStore((s) => s.previewDocumentId);
  const closePreview = useDocExplorerStore((s) => s.closePreview);

  const { previewUrl, isLoading, isError } = useDocumentPreview({ mimeType });
  const { startDownload } = useDocumentDownload();

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_PANEL_WIDTH);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = panelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) return;
      // Dragging left increases width (panel is on the right side)
      const delta = startX.current - moveEvent.clientX;
      const newWidth = Math.min(
        MAX_PANEL_WIDTH,
        Math.max(MIN_PANEL_WIDTH, startWidth.current + delta),
      );
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelWidth]);

  // Don't render when no document is selected
  if (previewDocumentId === null) {
    return null;
  }

  const canPreview = mimeType !== undefined && isPreviewable(mimeType);

  const handleDownload = () => {
    if (previewDocumentId) {
      startDownload([{ id: previewDocumentId, fileSize: 0 }]);
    }
  };

  return (
    <aside
      className="relative flex-shrink-0 border-l border-gray-200 bg-white flex flex-col"
      style={{ width: panelWidth }}
      data-testid="document-preview-panel"
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary-200 active:bg-primary-300 transition-colors z-10"
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview panel"
        data-testid="preview-resize-handle"
      />

      {/* Header with close button */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-medium text-gray-900">Preview</h3>
        <button
          onClick={closePreview}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Close preview"
          data-testid="preview-close-button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading && <PreviewLoading />}

        {!isLoading && (isError || !canPreview) && (
          <PreviewUnavailable onDownload={handleDownload} />
        )}

        {!isLoading && !isError && canPreview && previewUrl && (
          <PreviewContent mimeType={mimeType!} previewUrl={previewUrl} />
        )}
      </div>
    </aside>
  );
}

function PreviewLoading() {
  return (
    <div
      className="flex flex-col items-center justify-center h-full space-y-4 animate-pulse"
      data-testid="preview-loading"
    >
      <div className="h-48 w-full bg-gray-200 rounded" />
      <div className="h-4 w-2/3 bg-gray-200 rounded" />
      <div className="h-4 w-1/2 bg-gray-200 rounded" />
    </div>
  );
}

interface PreviewUnavailableProps {
  onDownload: () => void;
}

function PreviewUnavailable({ onDownload }: PreviewUnavailableProps) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full text-center space-y-4"
      data-testid="preview-unavailable"
    >
      <div className="flex items-center justify-center h-12 w-12 rounded-full bg-gray-100">
        <Download className="h-6 w-6 text-gray-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-900">
          Preview unavailable for this format
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Download the file to view its contents.
        </p>
      </div>
      <button
        onClick={onDownload}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 transition-colors"
        data-testid="preview-download-button"
      >
        <Download className="h-4 w-4" />
        Download
      </button>
    </div>
  );
}

interface PreviewContentProps {
  mimeType: string;
  previewUrl: string;
}

function PreviewContent({ mimeType, previewUrl }: PreviewContentProps) {
  if (mimeType === 'application/pdf') {
    return (
      <iframe
        src={previewUrl}
        className="w-full h-full min-h-[500px] rounded border border-gray-200"
        title="Document preview"
        data-testid="preview-iframe"
      />
    );
  }

  // image/jpeg or image/png
  return (
    <img
      src={previewUrl}
      alt="Document preview"
      className="w-full h-auto rounded border border-gray-200 object-contain"
      data-testid="preview-image"
    />
  );
}
