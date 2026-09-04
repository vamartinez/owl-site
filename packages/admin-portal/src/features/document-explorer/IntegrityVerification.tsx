import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { useIntegrityVerify } from './hooks/useIntegrityVerify';

interface IntegrityVerificationProps {
  documentId: string;
}

/**
 * IntegrityVerification displays a "Verify Integrity" button that triggers
 * a server-side SHA-256 hash comparison. Shows stored vs computed hash and
 * whether they match.
 *
 * Requirements: 7.5
 */
export function IntegrityVerification({ documentId }: IntegrityVerificationProps) {
  const { mutate, data, isPending, isError } = useIntegrityVerify();

  const handleVerify = () => {
    mutate(documentId);
  };

  return (
    <div className="space-y-3" data-testid="integrity-verification">
      <button
        type="button"
        onClick={handleVerify}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="verify-integrity-button"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        )}
        {isPending ? 'Verifying…' : 'Verify Integrity'}
      </button>

      {isError && (
        <p
          className="text-sm text-red-600"
          data-testid="integrity-error"
          role="alert"
        >
          Verification unavailable
        </p>
      )}

      {data && (
        <div
          className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2"
          data-testid="integrity-result"
        >
          <div className="space-y-1">
            <p className="text-xs text-gray-500">Stored hash</p>
            <p
              className="font-mono text-xs text-gray-800 truncate"
              title={data.storedHash}
              data-testid="stored-hash"
            >
              {data.storedHash}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-gray-500">Computed hash</p>
            <p
              className="font-mono text-xs text-gray-800 truncate"
              title={data.computedHash}
              data-testid="computed-hash"
            >
              {data.computedHash}
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1" data-testid="match-status">
            {data.match ? (
              <>
                <ShieldCheck className="h-4 w-4 text-green-600" aria-hidden="true" />
                <span className="text-sm font-medium text-green-700">Hashes match</span>
              </>
            ) : (
              <>
                <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden="true" />
                <span className="text-sm font-medium text-red-700">Hashes do not match</span>
              </>
            )}
          </div>

          <p className="text-xs text-gray-500" data-testid="verified-at">
            Verified at: {data.verifiedAt}
          </p>
        </div>
      )}
    </div>
  );
}
