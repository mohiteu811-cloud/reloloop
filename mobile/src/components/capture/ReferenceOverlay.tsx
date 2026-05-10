import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { captureTheme } from '@/theme/capture';

type Props = {
  referenceUri: string;
  shotName: string;
  opacity: number;
  chipBottomOffset: number;
};

export function ReferenceOverlay({
  referenceUri,
  shotName,
  opacity,
  chipBottomOffset,
}: Props) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, styles.frame]}>
        <Image
          source={{ uri: referenceUri }}
          style={[StyleSheet.absoluteFill, { opacity }]}
          contentFit="cover"
          transition={120}
          accessibilityIgnoresInvertColors
        />
      </View>

      <View
        style={[styles.chipWrap, { bottom: chipBottomOffset }]}
        pointerEvents="none"
      >
        <View style={styles.chip}>
          <Text style={styles.chipText} numberOfLines={1}>
            {shotName}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    borderColor: captureTheme.outline,
    overflow: 'hidden',
  },
  chipWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: 1,
    borderColor: captureTheme.pillBorder,
    maxWidth: '76%',
  },
  chipText: {
    color: captureTheme.text,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.15,
  },
});
