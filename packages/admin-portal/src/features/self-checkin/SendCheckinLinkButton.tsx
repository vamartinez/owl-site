import { useState } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { MessageSquare, Check, AlertTriangle } from 'lucide-react';
import { useSendCheckinLink } from './hooks';

interface SendCheckinLinkButtonProps {
  workerId: string;
  /** Pre-select a site to skip the picker (e.g. when opened from a site context). */
  siteId?: string;
  workerName?: string;
}

interface SitesResponse {
  sites: { id: string; name: string }[];
}

/**
 * Sends a one-time SMS self check-in magic link to a worker. Opens a modal to
 * pick the target site (unless siteId is provided), then POSTs /checkin/sms-link.
 */
export function SendCheckinLinkButton({ workerId, siteId, workerName }: SendCheckinLinkButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedSite, setSelectedSite] = useState(siteId ?? '');

  const sendLink = useSendCheckinLink();

  // Only fetch sites when the picker is needed and the modal is open.
  const needsPicker = !siteId;
  const { data: sitesData, isLoading: sitesLoading } = useApiQuery<SitesResponse>(
    ['sites', 'checkin-picker'],
    '/sites',
    undefined,
    { enabled: open && needsPicker }
  );

  const handleClose = () => {
    setOpen(false);
    setSelectedSite(siteId ?? '');
    sendLink.reset();
  };

  const handleSend = () => {
    const targetSite = siteId ?? selectedSite;
    if (!targetSite) return;
    sendLink.mutate({ workerId, siteId: targetSite });
  };

  const siteOptions =
    sitesData?.sites.map((s) => ({ value: s.id, label: s.name })) ?? [];

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MessageSquare size={16} />
        Send check-in link
      </Button>

      <Modal open={open} onClose={handleClose} title="Send SMS check-in link" size="sm">
        {sendLink.isSuccess && sendLink.data.sent ? (
          <div className="space-y-4 text-center py-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
              <Check className="text-green-600" size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Link sent</p>
              <p className="mt-1 text-sm text-gray-500">
                {workerName ? `${workerName} will` : 'The worker will'} receive a one-time check-in link by
                SMS.
                {sendLink.data.expires_at && (
                  <> It expires at {new Date(sendLink.data.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</>
                )}
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Send a single-use check-in link by SMS to {workerName ? <strong>{workerName}</strong> : 'this worker'}.
              The link identifies the worker automatically — no gate QR or identity challenge needed.
            </p>

            {needsPicker && (
              <Select
                label="Site"
                placeholder={sitesLoading ? 'Loading sites…' : 'Select a site'}
                value={selectedSite}
                onChange={(e) => setSelectedSite(e.target.value)}
                options={siteOptions}
                disabled={sitesLoading}
              />
            )}

            {sendLink.isError && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3" role="alert">
                <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={16} />
                <p className="text-sm text-red-700">{sendLink.error.message}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSend}
                disabled={sendLink.isPending || (needsPicker && !selectedSite)}
              >
                {sendLink.isPending ? 'Sending…' : 'Send link'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
