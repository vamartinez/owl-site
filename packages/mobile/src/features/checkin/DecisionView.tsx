import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../lib/theme';
import type { WorkerView } from './types';

const decisionUi = {
  allowed: {
    Icon: CheckCircle2,
    color: colors.green,
    ring: colors.greenBg,
    box: { bg: colors.greenBg, border: colors.greenBorder },
    title: 'Access granted',
  },
  conditional: {
    Icon: AlertTriangle,
    color: colors.yellow,
    ring: colors.yellowBg,
    box: { bg: colors.yellowBg, border: colors.yellowBorder },
    title: 'Conditional access',
  },
  denied: {
    Icon: XCircle,
    color: colors.red,
    ring: colors.redBg,
    box: { bg: colors.redBg, border: colors.redBorder },
    title: 'Access denied',
  },
} as const;

export function DecisionView({ view, siteName }: { view: WorkerView; siteName: string }) {
  const ui = decisionUi[view.decision];
  const { Icon } = ui;
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.ring, { backgroundColor: ui.ring }]}>
          <Icon size={30} color={ui.color} />
        </View>
        <Text style={styles.title}>{ui.title}</Text>
        <Text style={styles.site}>{siteName}</Text>
      </View>

      {view.reasons.length > 0 && (
        <View style={[styles.box, { backgroundColor: ui.box.bg, borderColor: ui.box.border }]}>
          {view.reasons.map((reason, i) => (
            <Text key={i} style={styles.reason}>
              {reason}
            </Text>
          ))}
        </View>
      )}

      {view.required_actions.length > 0 && (
        <View style={styles.actions}>
          <Text style={styles.actionsTitle}>What to do next</Text>
          {view.required_actions.map((action, i) => (
            <View key={i} style={styles.actionRow}>
              <View style={styles.dot} />
              <Text style={styles.actionText}>{action}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: { alignItems: 'center', gap: spacing.xs },
  ring: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  site: { fontSize: 14, color: colors.textMuted },
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  reason: { fontSize: 14, color: colors.text },
  actions: { gap: spacing.sm },
  actionsTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  actionRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    marginTop: 7,
  },
  actionText: { flex: 1, fontSize: 14, color: colors.textMuted },
});
