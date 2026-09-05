import { CameraView, useCameraPermissions } from 'expo-camera';
import { QrCode } from 'lucide-react-native';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { colors, radius, spacing } from '../../lib/theme';
import { extractToken } from './extract-token';

export { extractToken };

export function QrScanner({ onToken }: { onToken: (token: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  if (!permission) {
    return <View style={styles.scanArea} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permission}>
        <QrCode size={40} color={colors.primary} />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permText}>
          We use the camera only to scan the site check-in QR code.
        </Text>
        <Button label="Allow camera" onPress={() => void requestPermission()} />
      </View>
    );
  }

  return (
    <View style={styles.scanArea}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          const token = extractToken(data);
          if (token) {
            handled.current = true;
            onToken(token);
          }
        }}
      />
      <View style={styles.frame} pointerEvents="none" />
      <Text style={styles.hint}>Point the camera at the site QR code</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scanArea: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 220,
    height: 220,
    borderWidth: 3,
    borderColor: colors.white,
    borderRadius: radius.lg,
    opacity: 0.9,
  },
  hint: {
    position: 'absolute',
    bottom: spacing.lg,
    color: colors.white,
    fontSize: 14,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  permission: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  permTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  permText: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
});
