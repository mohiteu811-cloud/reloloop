import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureTheme } from '@/theme/capture';

type Props = {
  shotIndex: number;
  shotTotal: number;
  roomName: string;
  onClose: () => void;
};

export function CaptureTopBar({ shotIndex, shotTotal, roomName, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const progress = Math.min(1, Math.max(0, (shotIndex + 1) / shotTotal));

  return (
    <LinearGradient
      pointerEvents="box-none"
      colors={['rgba(0,0,0,0.78)', 'rgba(0,0,0,0.42)', 'rgba(0,0,0,0)']}
      style={[styles.wrap, { paddingTop: insets.top + 8 }]}
    >
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close walkthrough"
          hitSlop={12}
          onPress={onClose}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
        >
          <CloseIcon />
        </Pressable>

        <View style={styles.center}>
          <Text style={styles.counter} numberOfLines={1}>
            Shot {shotIndex + 1} of {shotTotal}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        </View>

        <View style={styles.roomPill}>
          <Text style={styles.roomText} numberOfLines={1}>
            {roomName}
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}

function CloseIcon() {
  return (
    <View style={iconStyles.box}>
      <View style={[iconStyles.bar, iconStyles.barA]} />
      <View style={[iconStyles.bar, iconStyles.barB]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 14,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: captureTheme.pillBg,
    borderWidth: 1,
    borderColor: captureTheme.pillBorder,
  },
  pressed: { opacity: 0.6 },
  center: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  counter: {
    color: captureTheme.text,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  progressTrack: {
    height: 2,
    width: '78%',
    maxWidth: 220,
    backgroundColor: captureTheme.progressTrack,
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: captureTheme.progressFill,
  },
  roomPill: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: captureTheme.pillBg,
    borderWidth: 1,
    borderColor: captureTheme.pillBorder,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 140,
  },
  roomText: {
    color: captureTheme.text,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

const iconStyles = StyleSheet.create({
  box: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  bar: {
    position: 'absolute',
    width: 18,
    height: 1.6,
    backgroundColor: captureTheme.text,
    borderRadius: 1,
  },
  barA: { transform: [{ rotate: '45deg' }] },
  barB: { transform: [{ rotate: '-45deg' }] },
});
