import { useRef } from 'react';
import {
  GestureResponderEvent,
  PanResponder,
  PanResponderGestureState,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { View as RNView } from 'react-native';
import { captureTheme, opacity as bounds } from '@/theme/capture';

type Props = {
  value: number;
  onChange: (next: number) => void;
  onCommit?: (next: number) => void;
};

const TRACK_WIDTH = 96;
const THUMB_SIZE = 16;

export function OpacityControl({ value, onChange, onCommit }: Props) {
  const trackRef = useRef<RNView>(null);
  const trackOriginX = useRef(0);
  const lastValue = useRef(value);
  lastValue.current = value;

  const measureTrack = () => {
    trackRef.current?.measureInWindow((x) => {
      trackOriginX.current = x;
    });
  };

  const updateFromAbsoluteX = (absoluteX: number) => {
    const x = absoluteX - trackOriginX.current;
    const ratio = clamp(x / TRACK_WIDTH, 0, 1);
    const next = round(bounds.min + ratio * (bounds.max - bounds.min));
    if (next !== lastValue.current) {
      onChange(next);
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        updateFromAbsoluteX(e.nativeEvent.pageX);
      },
      onPanResponderMove: (
        e: GestureResponderEvent,
        _gs: PanResponderGestureState,
      ) => {
        updateFromAbsoluteX(e.nativeEvent.pageX);
      },
      onPanResponderRelease: () => onCommit?.(lastValue.current),
      onPanResponderTerminate: () => onCommit?.(lastValue.current),
    }),
  ).current;

  const ratio = (value - bounds.min) / (bounds.max - bounds.min);
  const fillWidth = Math.round(ratio * TRACK_WIDTH);
  const thumbLeft = Math.round(ratio * TRACK_WIDTH - THUMB_SIZE / 2);

  return (
    <View style={styles.wrap} accessibilityLabel="Reference photo opacity">
      <View style={styles.icon}>
        <View style={styles.iconHalf} />
      </View>

      <View
        ref={trackRef}
        style={styles.track}
        onLayout={measureTrack}
        {...responder.panHandlers}
      >
        <View style={styles.trackBg} />
        <View style={[styles.trackFill, { width: fillWidth }]} />
        <View style={[styles.thumb, { left: thumbLeft }]} />
      </View>

      <Text style={styles.label}>{Math.round(value * 100)}%</Text>
    </View>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function round(value: number) {
  const stepped = Math.round(value / bounds.step) * bounds.step;
  return Number(stepped.toFixed(2));
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 16,
    backgroundColor: captureTheme.scrim,
    borderWidth: 1,
    borderColor: captureTheme.pillBorder,
  },
  icon: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.2,
    borderColor: captureTheme.text,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  iconHalf: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '50%',
    backgroundColor: captureTheme.text,
  },
  track: {
    width: TRACK_WIDTH,
    height: 28,
    justifyContent: 'center',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: captureTheme.progressTrack,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: captureTheme.progressFill,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: captureTheme.text,
    top: (28 - THUMB_SIZE) / 2,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  label: {
    color: captureTheme.text,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
    minWidth: 30,
    textAlign: 'right',
  },
});
