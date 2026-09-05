import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { QrScanner } from '../../src/features/checkin/QrScanner';
import { colors, spacing } from '../../src/lib/theme';

export default function ScanScreen() {
  return (
    <View style={styles.container}>
      <QrScanner
        onToken={(token) => {
          router.replace({ pathname: '/check-in/[token]', params: { token } });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
});
