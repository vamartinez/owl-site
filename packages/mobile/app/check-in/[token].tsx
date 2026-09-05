import { useLocalSearchParams } from 'expo-router';
import { AlertTriangle, XCircle } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { DecisionView } from '../../src/features/checkin/DecisionView';
import { IdentityForm } from '../../src/features/checkin/IdentityForm';
import { useResolveToken } from '../../src/features/checkin/hooks';
import { isTokenInvalid, isVerified, type WorkerView } from '../../src/features/checkin/types';
import { ApiError, verifyCheckin } from '../../src/lib/api-client';
import { colors, radius, spacing } from '../../src/lib/theme';

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
    <View style={styles.card}>
      <View style={styles.ring}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {action && <View style={styles.action}>{action}</View>}
    </View>
  );
}

export default function CheckinTokenScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const pageLoadTs = useRef(Date.now());

  const [decision, setDecision] = useState<WorkerView | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);

  const { data: resolved, isLoading, isError, refetch } = useResolveToken(token);

  const runVerify = useCallback(
    async (phoneLast4?: string, legalName?: string) => {
      if (!token) return;
      setVerifyError(null);
      setIsVerifying(true);
      try {
        const result = await verifyCheckin(token, {
          phone_last4: phoneLast4,
          legal_name: legalName,
          page_load_ts: pageLoadTs.current,
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
        if (err instanceof ApiError && err.status === 429) {
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

  const body = () => {
    if (isLoading) {
      return (
        <View style={styles.card}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.message}>Loading…</Text>
        </View>
      );
    }

    if (isError) {
      return (
        <CenterState
          icon={<AlertTriangle size={28} color={colors.red} />}
          title="Something went wrong"
          message="We could not reach the check-in service. Check your connection and try again."
          action={<Button label="Retry" variant="secondary" onPress={() => void refetch()} />}
        />
      );
    }

    if (!resolved || isTokenInvalid(resolved)) {
      return (
        <CenterState
          icon={<XCircle size={28} color={colors.textMuted} />}
          title="Link no longer valid"
          message={
            (resolved && isTokenInvalid(resolved) && resolved.message) ||
            'This check-in code is no longer valid. Ask your supervisor for a new one.'
          }
        />
      );
    }

    if (decision) {
      return <DecisionView view={decision} siteName={resolved.site_name} />;
    }

    // SMS flow auto-verifying.
    if (!resolved.requires_identity) {
      return verifyError ? (
        <CenterState
          icon={<AlertTriangle size={28} color={colors.red} />}
          title="Check-in failed"
          message={verifyError}
        />
      ) : (
        <View style={styles.card}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.message}>Checking you in…</Text>
        </View>
      );
    }

    // QR flow: identity challenge.
    return (
      <IdentityForm
        siteName={resolved.site_name}
        isSubmitting={isVerifying}
        error={verifyError}
        onSubmit={(phone, name) => void runVerify(phone, name)}
      />
    );
  };

  return <ScrollView contentContainerStyle={styles.scroll}>{body()}</ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, flexGrow: 1, justifyContent: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  ring: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  message: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  action: { marginTop: spacing.sm, alignSelf: 'stretch' },
});
