import { router } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../src/components/Button';
import { Field } from '../src/components/Field';
import { colors, radius, spacing } from '../src/lib/theme';
import { useAuthStore } from '../src/store/auth-store';

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = email.includes('@') && password.length >= 1 && !submitting;

  async function handleLogin() {
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.replace('/(app)');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.header}>
          <View style={styles.logo}>
            <ShieldCheck size={28} color={colors.primary} />
          </View>
          <Text style={styles.title}>Site Macaron</Text>
          <Text style={styles.subtitle}>Sign in to your compliance dashboard</Text>
        </View>

        <View style={styles.card}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="you@company.com"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholder="••••••••"
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Button
            label={submitting ? 'Signing in…' : 'Sign in'}
            loading={submitting}
            disabled={!canSubmit}
            onPress={() => void handleLogin()}
          />
        </View>

        <Text style={styles.note}>
          Checking in as a worker? Scan the site QR code — no sign-in needed.
        </Text>
        <Button label="Scan check-in QR" variant="secondary" onPress={() => router.push('/check-in/scan')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  header: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  logo: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textMuted },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  error: { fontSize: 13, color: colors.red },
  note: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
});
