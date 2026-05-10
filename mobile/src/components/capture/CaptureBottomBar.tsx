import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureTheme } from '@/theme/capture';
import type { Shot } from '@/types/walkthrough';

const SHUTTER = 80;
export const BOTTOM_BAR_TOP_PAD = 16;
export const BOTTOM_BAR_CONTENT_HEIGHT = 100;
export const BOTTOM_BAR_BOTTOM_PAD = 14;

export function bottomBarHeight(safeBottomInset: number): number {
  return (
    BOTTOM_BAR_TOP_PAD +
    BOTTOM_BAR_CONTENT_HEIGHT +
    BOTTOM_BAR_BOTTOM_PAD +
    Math.max(safeBottomInset, 12)
  );
}

type Props = {
  isLast: boolean;
  isCapturing: boolean;
  nextShot: Shot | null;
  onShutter: () => void;
  onSkip: () => void;
};

export function CaptureBottomBar({
  isLast,
  isCapturing,
  nextShot,
  onShutter,
  onSkip,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      pointerEvents="box-none"
      colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.42)', 'rgba(0,0,0,0.82)']}
      style={[
        styles.wrap,
        { paddingBottom: Math.max(insets.bottom, 12) + BOTTOM_BAR_BOTTOM_PAD },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.side}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip this shot"
            hitSlop={12}
            onPress={onSkip}
            disabled={isCapturing}
            style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        <View style={styles.center}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isLast ? 'Finish walkthrough' : 'Capture photo'}
            disabled={isCapturing}
            onPress={onShutter}
            style={({ pressed }) => [
              styles.shutterRing,
              pressed && styles.shutterPressed,
              isCapturing && styles.shutterBusy,
            ]}
          >
            <View style={styles.shutterCore}>
              {isLast ? <Text style={styles.finishText}>Finish</Text> : null}
            </View>
          </Pressable>
        </View>

        <View style={[styles.side, styles.sideRight]}>
          <NextPreview nextShot={nextShot} isLast={isLast} />
        </View>
      </View>
    </LinearGradient>
  );
}

function NextPreview({ nextShot, isLast }: { nextShot: Shot | null; isLast: boolean }) {
  if (isLast || !nextShot) {
    return (
      <View style={styles.nextWrap}>
        <View style={[styles.nextThumb, styles.nextThumbEmpty]} />
        <Text style={styles.nextLabel} numberOfLines={1}>
          Last shot
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.nextWrap}>
      <Image
        source={{ uri: nextShot.referencePhotoUrl }}
        style={styles.nextThumb}
        contentFit="cover"
        transition={120}
        accessibilityIgnoresInvertColors
      />
      <View style={styles.nextTextWrap}>
        <Text style={styles.nextEyebrow}>Next</Text>
        <Text style={styles.nextLabel} numberOfLines={1}>
          {nextShot.name}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: BOTTOM_BAR_TOP_PAD,
    paddingHorizontal: 14,
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: BOTTOM_BAR_CONTENT_HEIGHT,
  },
  side: { flex: 1, alignItems: 'flex-start', justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
  center: {
    width: SHUTTER + 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },

  skipBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  skipText: {
    color: captureTheme.text,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  shutterRing: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 4,
    borderColor: captureTheme.shutterRing,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  shutterBusy: { opacity: 0.5 },
  shutterCore: {
    width: SHUTTER - 14,
    height: SHUTTER - 14,
    borderRadius: (SHUTTER - 14) / 2,
    backgroundColor: captureTheme.shutterCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  nextWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 132,
  },
  nextThumb: {
    width: 36,
    height: 48,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  nextThumbEmpty: {
    borderWidth: 1,
    borderColor: captureTheme.pillBorder,
    borderStyle: 'dashed',
  },
  nextTextWrap: {
    flex: 1,
  },
  nextEyebrow: {
    color: captureTheme.textFaint,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  nextLabel: {
    color: captureTheme.text,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
