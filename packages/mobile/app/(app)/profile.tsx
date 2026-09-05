import { router } from 'expo-router';
import { LogOut, Mail, ShieldCheck } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { colors, radius, spacing } from '../../src/lib/theme';
import { useAuthStore } from '../../src/store/auth-store';

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.initials}>{initials(user?.name || user?.email)}</Text>
        </View>
        <Text style={styles.name}>{user?.name ?? '—'}</Text>

        <View style={styles.row}>
          <Mail size={16} color={colors.textMuted} />
          <Text style={styles.rowText}>{user?.email ?? '—'}</Text>
        </View>
        <View style={styles.row}>
          <ShieldCheck size={16} color={colors.textMuted} />
          <Text style={styles.rowText}>{user?.role ?? '—'}</Text>
        </View>
        {!!user?.tenantId && (
          <Text style={styles.tenant}>Tenant: {user.tenantId}</Text>
        )}
      </View>

      <Button label="Sign out" variant="secondary" onPress={() => void handleLogout()} />
      <View style={styles.signOutIcon}>
        <LogOut size={14} color={colors.textMuted} />
        <Text style={styles.note}>You'll need to sign in again to access your dashboard.</Text>
      </View>
    </ScrollView>
  );
}

function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '' + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontSize: 24, fontWeight: '700', color: colors.white },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowText: { fontSize: 14, color: colors.text },
  tenant: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs },
  signOutIcon: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 12, color: colors.textMuted },
});
