import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';

import { CaptureTopBar } from '@/components/capture/CaptureTopBar';
import {
  CaptureBottomBar,
  bottomBarHeight,
} from '@/components/capture/CaptureBottomBar';
import { ReferenceOverlay } from '@/components/capture/ReferenceOverlay';
import { OpacityControl } from '@/components/capture/OpacityControl';
import { ConfirmationOverlay } from '@/components/capture/ConfirmationOverlay';
import { SkipReasonModal } from '@/components/capture/SkipReasonModal';
import { PermissionDeniedView } from '@/components/capture/PermissionDeniedView';

import {
  initProgress,
  loadProgress,
  persistProgress,
  progressReducer,
  summarize,
} from '@/state/runProgress';
import { loadOpacityPref, saveOpacityPref } from '@/state/opacityPref';
import { uploadQueue } from '@/lib/uploadQueue';
import { captureTheme, opacity as opacityBounds } from '@/theme/capture';
import type { ShotResult, SkipReason, WalkthroughRun } from '@/types/walkthrough';

const CONFIRMATION_MS = 1500;
const MAX_LONG_EDGE = 1920;
const JPEG_QUALITY = 0.75;

type Props = {
  run: WalkthroughRun;
  onExit: () => void;
  onComplete: () => void;
};

export function CaptureScreen({ run, onExit, onComplete }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [progress, dispatch] = useReducer(progressReducer, run, initProgress);
  const [restored, setRestored] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(opacityBounds.default);

  const [skipOpen, setSkipOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    referenceUri: string;
    capturedUri: string;
  } | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const cameraRef = useRef<CameraView | null>(null);
  const advanceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = run.shots.length;
  const currentShot = run.shots[progress.currentIndex] ?? run.shots[total - 1];
  const nextShot = run.shots[progress.currentIndex + 1] ?? null;
  const isLast = progress.currentIndex >= total - 1;
  const summary = useMemo(() => summarize(progress, total), [progress, total]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, savedOpacity] = await Promise.all([
        loadProgress(run.id),
        loadOpacityPref(),
      ]);
      if (cancelled) return;
      if (stored && stored.runId === run.id) {
        const restoredIndex = nextUnfinishedIndex(run, stored.results, stored.currentIndex);
        dispatch({ type: 'restore', progress: { ...stored, currentIndex: restoredIndex } });
      }
      setOverlayOpacity(savedOpacity);
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [run]);

  useEffect(() => {
    if (!restored) return;
    persistProgress(progress);
  }, [progress, restored]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        persistProgress(progress);
      }
    });
    return () => sub.remove();
  }, [progress]);

  useEffect(() => {
    if (nextShot?.referencePhotoUrl) {
      ExpoImage.prefetch(nextShot.referencePhotoUrl).catch(() => {});
    }
  }, [nextShot?.referencePhotoUrl]);

  useEffect(() => {
    return () => {
      if (advanceTimeout.current) clearTimeout(advanceTimeout.current);
    };
  }, []);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleOpacityChange = useCallback((next: number) => {
    setOverlayOpacity(next);
  }, []);
  const handleOpacityCommit = useCallback((next: number) => {
    saveOpacityPref(next);
  }, []);

  const finishOrAdvance = useCallback(() => {
    if (isLast) {
      onComplete();
    } else {
      dispatch({ type: 'advance' });
    }
  }, [isLast, onComplete]);

  const handleShutter = useCallback(async () => {
    if (isCapturing || confirmation) return;
    if (!cameraRef.current) return;

    setIsCapturing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      const pic = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: false,
      });
      if (!pic?.uri) {
        setIsCapturing(false);
        return;
      }

      const longEdge = Math.max(pic.width ?? 0, pic.height ?? 0);
      const resizeAction =
        longEdge > MAX_LONG_EDGE
          ? [
              {
                resize:
                  (pic.width ?? 0) >= (pic.height ?? 0)
                    ? { width: MAX_LONG_EDGE }
                    : { height: MAX_LONG_EDGE },
              },
            ]
          : [];

      const processed = await ImageManipulator.manipulateAsync(pic.uri, resizeAction, {
        compress: JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      });

      const captured = {
        shotId: currentShot.id,
        localUri: processed.uri,
        width: processed.width,
        height: processed.height,
      };

      dispatch({ type: 'capture', shot: captured });

      uploadQueue.enqueue({
        runId: run.id,
        shotId: currentShot.id,
        localUri: processed.uri,
        width: processed.width,
        height: processed.height,
        enqueuedAt: new Date().toISOString(),
      });

      setConfirmation({
        referenceUri: currentShot.referencePhotoUrl,
        capturedUri: processed.uri,
      });

      advanceTimeout.current = setTimeout(() => {
        setConfirmation(null);
        setIsCapturing(false);
        finishOrAdvance();
      }, CONFIRMATION_MS);
    } catch (err) {
      console.warn('[capture] shutter failed', err);
      setIsCapturing(false);
      Alert.alert(
        'Capture failed',
        'Couldn’t save that photo. Try again — your progress is safe.',
      );
    }
  }, [confirmation, currentShot, finishOrAdvance, isCapturing, run.id]);

  const handleSkipConfirm = useCallback(
    (reason: SkipReason, note?: string) => {
      dispatch({
        type: 'skip',
        shot: { shotId: currentShot.id, reason, reasonNote: note },
      });
      setSkipOpen(false);
      finishOrAdvance();
    },
    [currentShot.id, finishOrAdvance],
  );

  const handleClose = useCallback(() => {
    Alert.alert(
      'Pause walkthrough?',
      `You’ve captured ${summary.captured} of ${summary.total} shots. We’ll save your progress so you can resume later.`,
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Pause',
          style: 'destructive',
          onPress: () => onExit(),
        },
      ],
    );
  }, [onExit, summary]);

  if (!permission) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={captureTheme.text} />
      </View>
    );
  }
  if (!permission.granted) {
    return <PermissionDeniedView onClose={onExit} />;
  }

  return (
    <View style={styles.root}>
      <View style={styles.viewfinder}>
        <CameraView
          ref={(r) => {
            cameraRef.current = r;
          }}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          ratio="4:3"
        />
        <ReferenceOverlay
          referenceUri={currentShot.referencePhotoUrl}
          shotName={currentShot.name}
          opacity={overlayOpacity}
          chipBottomOffset={bottomBarHeight(insets.bottom) + 12}
        />
        <View style={[styles.opacitySlot, { top: insets.top + 84 }]} pointerEvents="box-none">
          <OpacityControl
            value={overlayOpacity}
            onChange={handleOpacityChange}
            onCommit={handleOpacityCommit}
          />
        </View>
      </View>

      <CaptureTopBar
        shotIndex={progress.currentIndex}
        shotTotal={total}
        roomName={currentShot.roomName}
        onClose={handleClose}
      />

      <CaptureBottomBar
        isLast={isLast}
        isCapturing={isCapturing}
        nextShot={nextShot}
        onShutter={handleShutter}
        onSkip={() => setSkipOpen(true)}
      />

      {confirmation && (
        <ConfirmationOverlay
          referenceUri={confirmation.referenceUri}
          capturedUri={confirmation.capturedUri}
        />
      )}

      <SkipReasonModal
        visible={skipOpen}
        shotName={currentShot.name}
        required={currentShot.required}
        onCancel={() => setSkipOpen(false)}
        onConfirm={handleSkipConfirm}
      />
    </View>
  );
}

function nextUnfinishedIndex(
  run: WalkthroughRun,
  results: Record<string, ShotResult>,
  fallback: number,
): number {
  for (let i = 0; i < run.shots.length; i++) {
    if (!results[run.shots[i].id]) return i;
  }
  return Math.min(fallback, run.shots.length - 1);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: captureTheme.bg,
  },
  viewfinder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  opacitySlot: {
    position: 'absolute',
    right: 14,
    zIndex: 5,
    alignItems: 'flex-end',
  },
  loading: {
    flex: 1,
    backgroundColor: captureTheme.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
