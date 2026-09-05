import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { resolveCheckinToken, verifyCheckin, PublicCheckinError } from './api';
import {
  isTokenInvalid,
  isVerified,
  type ResolveTokenResult,
  type VerifyResult,
  type WorkerView,
} from './types';

// ─── Shells ─────────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-center gap-2 text-primary-600">
          <ShieldCheck size={22} />
          <span className="text-sm font-semibold tracking-wide uppercase">Site Check-In</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function CenterState({
  icon,
  title,
  message,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white shadow-sm border border-gray-200 p-6 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-50">
        {icon}
      </div>
      <h1 className="text-lg font-semibold text-gray-900 mb-2">{title}</h1>
      <p className="text-sm text-gray-500">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ─── Decision view (worker-scoped, no evidence/rule refs) ─────────────────────

const decisionUi = {
  allowed: {
    icon: <CheckCircle className="text-green-600" size={28} />,
    ring: 'bg-green-50',
    title: 'Access granted',
    box: 'bg-green-50 border-green-200',
  },
  conditional: {
    icon: <AlertTriangle className="text-yellow-600" size={28} />,
    ring: 'bg-yellow-50',
    title: 'Conditional access',
    box: 'bg-yellow-50 border-yellow-200',
  },
  denied: {
    icon: <XCircle className="text-red-600" size={28} />,
    ring: 'bg-red-50',
    title: 'Access denied',
    box: 'bg-red-50 border-red-200',
  },
} as const;

function DecisionView({ view, siteName }: { view: WorkerView; siteName: string }) {
  const ui = decisionUi[view.decision];
  return (
    <div className="rounded-lg bg-white shadow-sm border border-gray-200 p-6">
      <div className="text-center">
        <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${ui.ring}`}>
          {ui.icon}
        </div>
        <h1 className="text-xl font-semibold text-gray-900">{ui.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{siteName}</p>
      </div>

      {view.reasons.length > 0 && (
        <div className={`mt-5 rounded-md border p-4 ${ui.box}`}>
          <ul className="space-y-1.5">
            {view.reasons.map((reason, i) => (
              <li key={i} className="text-sm text-gray-700">
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.required_actions.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-gray-700 mb-2">What to do next</p>
          <ul className="space-y-2">
            {view.required_actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary-500" />
                {action}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Identity challenge (QR flow) ─────────────────────────────────────────────

function IdentityForm({
  onSubmit,
  isSubmitting,
  error,
  siteName,
  honeypotRef,
}: {
  onSubmit: (phoneLast4: string, legalName: string) => void;
  isSubmitting: boolean;
  error: string | null;
  siteName: string;
  honeypotRef: React.RefObject<HTMLInputElement>;
}) {
  const [phoneLast4, setPhoneLast4] = useState('');
  const [legalName, setLegalName] = useState('');

  const phoneValid = /^\d{4}$/.test(phoneLast4);
  const nameValid = legalName.trim().length >= 2;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneValid || !nameValid) return;
    onSubmit(phoneLast4, legalName.trim());
  };

  return (
    <div className="rounded-lg bg-white shadow-sm border border-gray-200 p-6">
      <h1 className="text-lg font-semibold text-gray-900">Verify your identity</h1>
      <p className="mt-1 text-sm text-gray-500">
        Checking in at <strong>{siteName}</strong>. Confirm who you are to continue.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="legal_name" className="block text-sm font-medium text-gray-700 mb-1">
            Full legal name
          </label>
          <input
            id="legal_name"
            type="text"
            autoComplete="name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
            placeholder="As registered with your employer"
          />
        </div>

        <div>
          <label htmlFor="phone_last4" className="block text-sm font-medium text-gray-700 mb-1">
            Last 4 digits of your phone number
          </label>
          <input
            id="phone_last4"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={phoneLast4}
            onChange={(e) => setPhoneLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm tracking-widest focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
            placeholder="0000"
          />
        </div>

        {/* Honeypot — hidden from real users, catches bots. */}
        <input
          ref={honeypotRef}
          type="text"
          name="company_website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3" role="alert">
            <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={16} />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !phoneValid || !nameValid}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
          {isSubmitting ? 'Verifying…' : 'Check in'}
        </button>
      </form>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PublicCheckinPage() {
  const { token } = useParams<{ token: string }>();
  const pageLoadTs = useRef(Date.now());
  const honeypotRef = useRef<HTMLInputElement>(null);

  const [decision, setDecision] = useState<WorkerView | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);

  const {
    data: resolved,
    isLoading,
    isError,
    refetch,
  } = useQuery<ResolveTokenResult, PublicCheckinError>({
    queryKey: ['checkin-token', token],
    queryFn: () => resolveCheckinToken(token!),
    enabled: !!token,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });

  const runVerify = useCallback(
    async (phoneLast4?: string, legalName?: string) => {
      if (!token) return;
      setVerifyError(null);
      setIsVerifying(true);
      try {
        const result: VerifyResult = await verifyCheckin(token, {
          phone_last4: phoneLast4,
          legal_name: legalName,
          page_load_ts: pageLoadTs.current,
          hp: honeypotRef.current?.value || undefined,
        });
        if (isVerified(result)) {
          setDecision({
            decision: result.decision,
            reasons: result.reasons,
            required_actions: result.required_actions,
          });
        } else {
          setVerifyError(result.message);
        }
      } catch (err) {
        if (err instanceof PublicCheckinError && err.status === 429) {
          setVerifyError('Too many attempts. Please wait a moment and try again.');
        } else {
          setVerifyError('We could not complete your check-in. Please try again.');
        }
      } finally {
        setIsVerifying(false);
      }
    },
    [token]
  );

  // SMS flow: token identifies the worker → verify automatically, once.
  const validResolved = resolved && !isTokenInvalid(resolved) ? resolved : null;
  useEffect(() => {
    if (validResolved && !validResolved.requires_identity && !autoStarted && !decision) {
      setAutoStarted(true);
      void runVerify();
    }
  }, [validResolved, autoStarted, decision, runVerify]);

  if (!token) {
    return (
      <PageShell>
        <CenterState
          icon={<XCircle className="text-gray-400" size={28} />}
          title="Invalid link"
          message="This check-in link is missing its code. Please scan the QR again."
        />
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <div className="rounded-lg bg-white shadow-sm border border-gray-200 p-10 flex flex-col items-center">
          <Loader2 className="animate-spin text-primary-600 mb-3" size={28} />
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell>
        <CenterState
          icon={<AlertTriangle className="text-red-500" size={28} />}
          title="Something went wrong"
          message="We could not reach the check-in service. Check your connection and try again."
          action={
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 rounded-md bg-primary-50 px-4 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100"
            >
              <RefreshCw size={16} />
              Retry
            </button>
          }
        />
      </PageShell>
    );
  }

  // Uniform invalid-token response.
  if (!resolved || isTokenInvalid(resolved)) {
    return (
      <PageShell>
        <CenterState
          icon={<XCircle className="text-gray-400" size={28} />}
          title="Link no longer valid"
          message={
            (resolved && isTokenInvalid(resolved) && resolved.message) ||
            'This check-in link is no longer valid. Ask your supervisor for a new one.'
          }
        />
      </PageShell>
    );
  }

  // Decision reached.
  if (decision) {
    return (
      <PageShell>
        <DecisionView view={decision} siteName={resolved.site_name} />
      </PageShell>
    );
  }

  // SMS flow auto-verifying.
  if (!resolved.requires_identity) {
    return (
      <PageShell>
        <div className="rounded-lg bg-white shadow-sm border border-gray-200 p-10 flex flex-col items-center">
          {verifyError ? (
            <CenterState
              icon={<AlertTriangle className="text-red-500" size={28} />}
              title="Check-in failed"
              message={verifyError}
            />
          ) : (
            <>
              <Loader2 className="animate-spin text-primary-600 mb-3" size={28} />
              <p className="text-sm text-gray-500">Checking you in…</p>
            </>
          )}
        </div>
      </PageShell>
    );
  }

  // QR flow: identity challenge.
  return (
    <PageShell>
      <IdentityForm
        onSubmit={(phone, name) => runVerify(phone, name)}
        isSubmitting={isVerifying}
        error={verifyError}
        siteName={resolved.site_name}
        honeypotRef={honeypotRef}
      />
    </PageShell>
  );
}
