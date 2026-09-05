import { useEffect, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { QrCode, Download, Copy, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { useSiteCheckinToken, useRegenerateSiteToken } from './hooks';

interface SiteCheckinQRProps {
  siteId: string;
  siteName?: string;
}

/**
 * Admin card that surfaces the site's persistent self check-in QR code.
 *
 * On mount it fetches (creating if absent) the site token, renders the
 * public_url as a QR to a canvas, and offers download / copy-link / regenerate.
 */
export function SiteCheckinQR({ siteId, siteName }: SiteCheckinQRProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const tokenMutation = useSiteCheckinToken();
  const regenMutation = useRegenerateSiteToken();

  const isLoading = tokenMutation.isPending || regenMutation.isPending;
  const error = tokenMutation.error || regenMutation.error;

  // Fetch (create-if-absent) the token on mount / when the site changes.
  useEffect(() => {
    if (!siteId) return;
    tokenMutation.mutate(siteId, {
      onSuccess: (data) => setPublicUrl(data.public_url),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // Render the QR whenever the URL changes.
  useEffect(() => {
    if (!publicUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, publicUrl, { width: 220, margin: 2 }, (err) => {
      if (err) console.error('QR render failed', err);
    });
  }, [publicUrl]);

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `check-in-${siteName ? siteName.replace(/\s+/g, '-').toLowerCase() : siteId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [siteId, siteName]);

  const handleCopy = useCallback(async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied — silently ignore */
    }
  }, [publicUrl]);

  const handleRegenerate = useCallback(() => {
    setConfirmRegen(false);
    regenMutation.mutate(siteId, {
      onSuccess: (data) => setPublicUrl(data.public_url),
    });
  }, [siteId, regenMutation]);

  return (
    <Card>
      <CardHeader
        title="Self Check-In QR"
        description="Workers scan this code at the gate to check in"
        action={<QrCode size={20} className="text-primary-600" />}
      />
      <CardContent>
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3" role="alert">
            <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={16} />
            <p className="text-sm text-red-700">{error.message}</p>
          </div>
        )}

        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-3 min-h-[240px] min-w-[240px]">
            {isLoading && !publicUrl ? (
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            ) : (
              <canvas ref={canvasRef} aria-label="Site check-in QR code" />
            )}
          </div>

          {publicUrl && (
            <div className="w-full max-w-sm space-y-3">
              <div className="flex items-center gap-2 rounded-md bg-gray-50 border border-gray-200 px-3 py-2">
                <span className="flex-1 truncate text-xs text-gray-600" title={publicUrl}>
                  {publicUrl}
                </span>
                <button
                  onClick={handleCopy}
                  className="flex-shrink-0 p-1 rounded hover:bg-gray-200 text-gray-500"
                  aria-label="Copy check-in link"
                >
                  {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                </button>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleDownload} className="flex-1">
                  <Download size={16} />
                  Download PNG
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRegen(true)}
                  disabled={isLoading}
                >
                  <RefreshCw size={16} />
                  Regenerate
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>

      <Modal open={confirmRegen} onClose={() => setConfirmRegen(false)} title="Regenerate QR code?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            The current QR code will stop working immediately. Anyone using a printed copy of the old
            code will be unable to check in until they scan the new one. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmRegen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRegenerate}>
              Regenerate
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
