import { router } from 'expo-router';
import { MapPin, ScanLine, ShieldCheck } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { colors, radius, spacing } from '../../src/lib/theme';
import { useAuthStore } from '../../src/store/auth-store';

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.greeting}>
        <Text style={styles.hi}>Welcome back</Text>
        <Text style={styles.name}>{user?.name ?? user?.email}</Text>
        <View style={styles.roleBadge}>
          <ShieldCheck size={13} color={colors.primary} />
          <Text style={styles.roleText}>{formatRole(user?.role)}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <MapPin size={18} color={colors.primary} />
          <Text style={styles.cardTitle}>Assigned sites</Text>
        </View>
        {user?.assignedSites && user.assignedSites.length > 0 ? (
          user.assignedSites.map((site) => (
            <Text key={site} style={styles.siteRow}>
              {site}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No sites assigned to your account.</Text>
        )}
      </View>

      <Button
        label="Scan a check-in QR"
        onPress={() => router.push('/(app)/scan')}
      />
      <View style={styles.hintRow}>
        <ScanLine size={14} color={colors.textMuted} />
        <Text style={styles.hint}>
          Scan a worker's site QR to run an access decision on the spot.
        </Text>
      </View>
    </ScrollView>
  );
}

function formatRole(role?: string): string {
  if (!role) return 'Member';
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, gap: spacing.md },
  greeting: { gap: spacing.xs },
  hi: { fontSize: 14, color: colors.textMuted },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: spacing.xs,
  },
  roleText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  siteRow: {
    fontSize: 14,
    color: colors.text,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  empty: { fontSize: 14, color: colors.textMuted },
  hintRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  hint: { flex: 1, fontSize: 13, color: colors.textMuted },
});
