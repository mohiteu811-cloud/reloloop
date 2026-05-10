import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureTheme } from '@/theme/capture';

type Props = {
  onClose: () => void;
};

export function PermissionDeniedView({ onClose }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 16 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={12}
        onPress={onClose}
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <Text style={styles.closeText}>Close</Text>
      </Pressable>

      <View style={styles.body}>
        <View style={styles.lensWrap}>
          <View style={styles.lensOuter}>
            <View style={styles.lensInner} />
          </View>
        </View>
        <Text style={styles.title}>Camera access is off</Text>
        <Text style={styles.copy}>
          ReloLoop needs the camera to capture walkthrough photos against the
          host's reference shots. Turn it on in Settings to keep going.
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => Linking.openSettings()}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText}>Open settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: captureTheme.bg,
    paddingHorizontal: 24,
  },
  pressed: { opacity: 0.65 },
  close: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: captureTheme.pillBg,
    borderWidth: 1,
    borderColor: captureTheme.pillBorder,
  },
  closeText: {
    color: captureTheme.text,
    fontSize: 13,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  lensWrap: { marginBottom: 8 },
  lensOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2,
    borderColor: captureTheme.outlineSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lensInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: captureTheme.outlineSoft,
  },
  title: {
    color: captureTheme.text,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  copy: {
    color: captureTheme.textDim,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
  cta: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: captureTheme.text,
  },
  ctaText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
