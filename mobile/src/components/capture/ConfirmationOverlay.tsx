import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { captureTheme } from '@/theme/capture';

type Props = {
  referenceUri: string;
  capturedUri: string;
};

export function ConfirmationOverlay({ referenceUri, capturedUri }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 140,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    Animated.spring(checkScale, {
      toValue: 1,
      friction: 5,
      tension: 110,
      useNativeDriver: true,
    }).start();
  }, [opacity, checkScale]);

  return (
    <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="none">
      <View style={styles.pair}>
        <View style={styles.tile}>
          <Image
            source={{ uri: referenceUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
          <View style={styles.tileLabelWrap}>
            <View style={styles.tileLabel}>
              <Animated.Text style={styles.tileLabelText}>Reference</Animated.Text>
            </View>
          </View>
        </View>

        <View style={styles.tile}>
          <Image
            source={{ uri: capturedUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
          <View style={styles.tileLabelWrap}>
            <View style={styles.tileLabel}>
              <Animated.Text style={styles.tileLabelText}>Captured</Animated.Text>
            </View>
          </View>
        </View>
      </View>

      <Animated.View style={[styles.checkBubble, { transform: [{ scale: checkScale }] }]}>
        <CheckIcon />
      </Animated.View>
    </Animated.View>
  );
}

function CheckIcon() {
  return (
    <View style={iconStyles.box}>
      <View style={[iconStyles.bar, iconStyles.barShort]} />
      <View style={[iconStyles.bar, iconStyles.barLong]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    paddingHorizontal: 16,
  },
  pair: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    maxWidth: 520,
    aspectRatio: 16 / 11,
  },
  tile: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: captureTheme.pillBorder,
    backgroundColor: '#111',
  },
  tileLabelWrap: {
    position: 'absolute',
    left: 8,
    bottom: 8,
  },
  tileLabel: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  tileLabelText: {
    color: captureTheme.text,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  checkBubble: {
    marginTop: 18,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: captureTheme.ok,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const iconStyles = StyleSheet.create({
  box: {
    width: 22,
    height: 22,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  bar: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 1.4,
  },
  barShort: {
    width: 9,
    height: 2.6,
    left: 2,
    top: 12,
    transform: [{ rotate: '45deg' }],
  },
  barLong: {
    width: 16,
    height: 2.6,
    left: 6,
    top: 9,
    transform: [{ rotate: '-45deg' }],
  },
});
