import { AlertTriangle } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { colors, radius, spacing } from '../../lib/theme';

interface IdentityFormProps {
  siteName: string;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (phoneLast4: string, legalName: string) => void;
}

export function IdentityForm({ siteName, isSubmitting, error, onSubmit }: IdentityFormProps) {
  const [legalName, setLegalName] = useState('');
  const [phoneLast4, setPhoneLast4] = useState('');

  const phoneValid = /^\d{4}$/.test(phoneLast4);
  const nameValid = legalName.trim().length >= 2;
  const canSubmit = phoneValid && nameValid && !isSubmitting;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Verify your identity</Text>
      <Text style={styles.subtitle}>
        Checking in at <Text style={styles.bold}>{siteName}</Text>. Confirm who you are to
        continue.
      </Text>

      <View style={styles.form}>
        <Field
          label="Full legal name"
          value={legalName}
          onChangeText={setLegalName}
          autoComplete="name"
          placeholder="As registered with your employer"
        />
        <Field
          label="Last 4 digits of your phone number"
          value={phoneLast4}
          onChangeText={(t) => setPhoneLast4(t.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="0000"
        />

        {error && (
          <View style={styles.error}>
            <AlertTriangle size={16} color={colors.red} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Button
          label={isSubmitting ? 'Verifying…' : 'Check in'}
          loading={isSubmitting}
          disabled={!canSubmit}
          onPress={() => onSubmit(phoneLast4, legalName.trim())}
        />
      </View>
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
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: spacing.xs },
  bold: { fontWeight: '600', color: colors.text },
  form: { marginTop: spacing.md, gap: spacing.md },
  error: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.redBg,
    borderColor: colors.redBorder,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    alignItems: 'flex-start',
  },
  errorText: { flex: 1, fontSize: 13, color: colors.red },
});
