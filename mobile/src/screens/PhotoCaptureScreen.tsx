import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/theme/colors";
import {
  completeWalkthrough,
  createWalkthrough,
} from "@/api/walkthroughs";
import { uploadQueue, type UploadStatus } from "@/upload/queue";
import type { CapturedPhoto, Walkthrough, WalkthroughType } from "@/types";

const MAX_LONG_EDGE = 1920;
const RESIZE_QUALITY = 0.75;
const CAPTURE_QUALITY = 0.7;
const PROMINENT_DONE_THRESHOLD = 5;

const WALKTHROUGH_LABELS: Record<WalkthroughType, string> = {
  MOVE_IN: "Move-in",
  MOVE_OUT: "Move-out",
  MID_TENANCY: "Mid-tenancy",
  MARKETING: "Marketing",
};

export type PhotoCaptureScreenProps = {
  propertyId: string;
  propertyName: string;
  walkthroughType: WalkthroughType;
  onComplete: (walkthrough: Walkthrough) => void;
  onCancel: () => void;
};

export function PhotoCaptureScreen({
  propertyId,
  propertyName,
  walkthroughType,
  onComplete,
  onCancel,
}: PhotoCaptureScreenProps) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [walkthrough, setWalkthrough] = useState<Walkthrough | null>(null);
  const [walkthroughError, setWalkthroughError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isCreatingWalkthrough, setIsCreatingWalkthrough] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    pending: 0,
    inFlight: 0,
    failed: 0,
  });

  const flashOpacity = useRef(new Animated.Value(0)).current;
  const askedPermissionRef = useRef(false);
  const creatingWalkthroughRef = useRef(false);
  const walkthroughRef = useRef<Walkthrough | null>(null);

  useEffect(() => {
    walkthroughRef.current = walkthrough;
  }, [walkthrough]);

  // Permission: auto-request once, only while still undetermined. After an
  // explicit denial we surface the empty state instead of looping prompts.
  useEffect(() => {
    if (!permission) return;
    if (askedPermissionRef.current) return;
    if (permission.status !== "undetermined") return;
    askedPermissionRef.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  const startWalkthrough = useCallback(async () => {
    if (creatingWalkthroughRef.current) return;
    if (walkthroughRef.current) return;
    creatingWalkthroughRef.current = true;
    setIsCreatingWalkthrough(true);
    setWalkthroughError(null);
    try {
      const w = await createWalkthrough({ propertyId, type: walkthroughType });
      setWalkthrough(w);
    } catch (err) {
      setWalkthroughError(
        err instanceof Error
          ? err.message
          : "Could not start walkthrough. Check your connection.",
      );
    } finally {
      creatingWalkthroughRef.current = false;
      setIsCreatingWalkthrough(false);
    }
  }, [propertyId, walkthroughType]);

  // Defer the POST until the user has actually granted camera permission so we
  // don't litter the server with abandoned walkthroughs from people who back
  // out at the permission prompt.
  useEffect(() => {
    if (!permission?.granted) return;
    if (walkthrough) return;
    void startWalkthrough();
  }, [permission?.granted, walkthrough, startWalkthrough]);

  // Subscribe to upload progress for the optional Done overlay.
  useEffect(() => {
    return uploadQueue.subscribe(setUploadStatus);
  }, []);

  const triggerFlash = useCallback(() => {
    flashOpacity.setValue(0.85);
    Animated.timing(flashOpacity, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [flashOpacity]);

  const onShutter = useCallback(async () => {
    if (isCapturing || isFinishing) return;
    if (!walkthrough) return;
    if (!cameraReady) return;
    if (!cameraRef.current) return;

    setIsCapturing(true);
    triggerFlash();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const raw = await cameraRef.current.takePictureAsync({
        quality: CAPTURE_QUALITY,
        skipProcessing: false,
      });
      if (!raw) return;

      const longEdge = Math.max(raw.width, raw.height);
      const resize =
        longEdge > MAX_LONG_EDGE
          ? raw.width >= raw.height
            ? { width: MAX_LONG_EDGE }
            : { height: MAX_LONG_EDGE }
          : null;

      const manipulated = await ImageManipulator.manipulateAsync(
        raw.uri,
        resize ? [{ resize }] : [],
        {
          compress: RESIZE_QUALITY,
          format: ImageManipulator.SaveFormat.JPEG,
        },
      );

      const photo: CapturedPhoto = {
        id: makeId(),
        uri: manipulated.uri,
        width: manipulated.width,
        height: manipulated.height,
        capturedAt: Date.now(),
      };

      setPhotos((prev) => [...prev, photo]);
      uploadQueue.enqueue(walkthrough.id, photo);
    } catch (err) {
      console.warn("[PhotoCapture] capture failed", err);
      Alert.alert("Capture failed", "Try again in a moment.");
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, isFinishing, cameraReady, walkthrough, triggerFlash]);

  const onDone = useCallback(async () => {
    if (!walkthrough || photos.length === 0 || isFinishing) return;
    setIsFinishing(true);

    const finalize = async () => {
      const completed = await completeWalkthrough(walkthrough.id);
      onComplete(completed);
    };

    try {
      await uploadQueue.waitForIdle(walkthrough.id);
      const status = uploadQueue.status(walkthrough.id);

      if (status.failed > 0) {
        const failed = status.failed;
        Alert.alert(
          `${failed} photo${failed === 1 ? "" : "s"} didn't upload`,
          "Retry the failed uploads or finish without them.",
          [
            {
              text: "Cancel",
              style: "cancel",
              onPress: () => setIsFinishing(false),
            },
            {
              text: "Retry",
              onPress: () => {
                uploadQueue.retryFailed(walkthrough.id);
                setIsFinishing(false);
              },
            },
            {
              text: "Finish anyway",
              style: "destructive",
              onPress: () => {
                void finalize().catch((err) => {
                  Alert.alert(
                    "Finish failed",
                    err instanceof Error
                      ? err.message
                      : "Could not finish walkthrough. Try again.",
                  );
                  setIsFinishing(false);
                });
              },
            },
          ],
        );
        return;
      }

      await finalize();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not finish walkthrough. Try again.";
      Alert.alert("Finish failed", message);
      setIsFinishing(false);
    }
  }, [walkthrough, photos.length, isFinishing, onComplete]);

  const discardAndCancel = useCallback(() => {
    if (walkthrough) uploadQueue.cancel(walkthrough.id);
    onCancel();
  }, [walkthrough, onCancel]);

  const onCancelPress = useCallback(() => {
    if (photos.length === 0) {
      if (walkthrough) uploadQueue.cancel(walkthrough.id);
      onCancel();
      return;
    }
    Alert.alert(
      "Discard walkthrough?",
      `You'll lose ${photos.length} photo${photos.length === 1 ? "" : "s"}.`,
      [
        { text: "Keep capturing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: discardAndCancel },
      ],
    );
  }, [photos.length, walkthrough, onCancel, discardAndCancel]);

  const recentThumbs = useMemo(() => photos.slice(-3), [photos]);
  const doneEnabled = photos.length >= 1 && !isFinishing && !!walkthrough;
  const doneProminent = photos.length >= PROMINENT_DONE_THRESHOLD;

  if (!permission) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.paper} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <PermissionEmptyState
        canAskAgain={permission.canAskAgain}
        onRequest={requestPermission}
        onCancel={onCancel}
      />
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setCameraReady(true)}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          styles.flash,
          { opacity: flashOpacity },
        ]}
      />

      <SafeAreaView style={styles.topBar} edges={["top"]}>
        <View style={styles.titleBlock}>
          <Text style={styles.propertyName} numberOfLines={1}>
            {propertyName}
          </Text>
          <Text style={styles.walkthroughType}>
            {WALKTHROUGH_LABELS[walkthroughType]} walkthrough
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel walkthrough"
          hitSlop={12}
          onPress={onCancelPress}
          style={styles.cancelButton}
        >
          <Text style={styles.cancelGlyph}>×</Text>
        </Pressable>
      </SafeAreaView>

      {walkthroughError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{walkthroughError}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isCreatingWalkthrough}
            onPress={() => {
              void startWalkthrough();
            }}
            style={styles.errorRetry}
          >
            <Text style={styles.errorRetryText}>
              {isCreatingWalkthrough ? "Retrying…" : "Retry"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <SafeAreaView style={styles.bottomBar} edges={["bottom"]}>
        <ThumbnailStrip photos={recentThumbs} totalCount={photos.length} />
        <ShutterButton
          onPress={onShutter}
          disabled={
            !walkthrough || !cameraReady || isCapturing || isFinishing
          }
          busy={isCapturing}
        />
        <DoneButton
          onPress={onDone}
          enabled={doneEnabled}
          prominent={doneProminent}
          busy={isFinishing}
        />
      </SafeAreaView>

      {isFinishing ? (
        <FinishingOverlay status={uploadStatus} />
      ) : null}
    </View>
  );
}

function ThumbnailStrip({
  photos,
  totalCount,
}: {
  photos: CapturedPhoto[];
  totalCount: number;
}) {
  if (totalCount === 0) {
    return <View style={styles.thumbStrip} />;
  }
  return (
    <View style={styles.thumbStrip}>
      <View style={styles.thumbStack}>
        {photos.map((photo, idx) => (
          <Image
            key={photo.id}
            source={{ uri: photo.uri }}
            style={[
              styles.thumb,
              { left: idx * 18, zIndex: photos.length - idx },
            ]}
          />
        ))}
      </View>
      <View style={styles.countBadge}>
        <Text style={styles.countBadgeText}>{totalCount}</Text>
      </View>
    </View>
  );
}

function ShutterButton({
  onPress,
  disabled,
  busy,
}: {
  onPress: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Capture photo"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.shutterOuter,
        pressed && !disabled ? styles.shutterOuterPressed : null,
      ]}
    >
      <View
        style={[
          styles.shutterInner,
          busy ? styles.shutterInnerBusy : null,
        ]}
      />
    </Pressable>
  );
}

function DoneButton({
  onPress,
  enabled,
  prominent,
  busy,
}: {
  onPress: () => void;
  enabled: boolean;
  prominent: boolean;
  busy: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Finish walkthrough"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[
        styles.doneButton,
        prominent ? styles.doneButtonProminent : styles.doneButtonMuted,
        !enabled ? styles.doneButtonDisabled : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.paper} />
      ) : (
        <Text
          style={[
            styles.doneText,
            prominent ? styles.doneTextProminent : null,
          ]}
        >
          Done
        </Text>
      )}
    </Pressable>
  );
}

function FinishingOverlay({ status }: { status: UploadStatus }) {
  const remaining = status.pending + status.inFlight;
  return (
    <View style={styles.finishOverlay} pointerEvents="auto">
      <View style={styles.finishCard}>
        <ActivityIndicator color={colors.clay} />
        <Text style={styles.finishTitle}>Finishing up…</Text>
        <Text style={styles.finishSubtitle}>
          {remaining > 0
            ? `Uploading ${remaining} photo${remaining === 1 ? "" : "s"}`
            : "Wrapping things up"}
        </Text>
      </View>
    </View>
  );
}

function PermissionEmptyState({
  canAskAgain,
  onRequest,
  onCancel,
}: {
  canAskAgain: boolean;
  onRequest: () => void;
  onCancel: () => void;
}) {
  return (
    <SafeAreaView style={styles.permissionRoot}>
      <View style={styles.permissionCard}>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionBody}>
          ReloLoop captures walkthrough photos right from your phone. Grant
          camera access to continue.
        </Text>
        {canAskAgain ? (
          <Pressable
            style={[styles.permissionButton, styles.permissionPrimary]}
            onPress={onRequest}
          >
            <Text style={styles.permissionPrimaryText}>Allow camera</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.permissionButton, styles.permissionPrimary]}
            onPress={() => {
              void Linking.openSettings();
            }}
          >
            <Text style={styles.permissionPrimaryText}>Open settings</Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.permissionButton, styles.permissionGhost]}
          onPress={onCancel}
        >
          <Text style={styles.permissionGhostText}>Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  fullCenter: {
    flex: 1,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  flash: {
    backgroundColor: "#fff",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: "rgba(5, 26, 31, 0.55)",
  },
  titleBlock: {
    flex: 1,
    paddingRight: 16,
  },
  propertyName: {
    color: colors.paper,
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  walkthroughType: {
    color: colors.moss,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: 4,
  },
  cancelButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  cancelGlyph: {
    color: colors.paper,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: "300",
  },
  errorBanner: {
    position: "absolute",
    top: 96,
    left: 16,
    right: 16,
    backgroundColor: colors.danger,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  errorText: {
    color: colors.paper,
    fontSize: 13,
    flex: 1,
  },
  errorRetry: {
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  errorRetryText: {
    color: colors.paper,
    fontSize: 13,
    fontWeight: "600",
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(5, 26, 31, 0.55)",
  },
  thumbStrip: {
    width: 96,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
  },
  thumbStack: {
    width: 76,
    height: 56,
    position: "relative",
  },
  thumb: {
    position: "absolute",
    top: 0,
    width: 40,
    height: 56,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.paper,
    backgroundColor: colors.ink,
  },
  countBadge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: colors.clay,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  countBadgeText: {
    color: colors.paper,
    fontSize: 12,
    fontWeight: "700",
  },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  shutterOuterPressed: {
    transform: [{ scale: 0.96 }],
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.shutter,
  },
  shutterInnerBusy: {
    backgroundColor: colors.moss,
  },
  doneButton: {
    minWidth: 96,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  doneButtonMuted: {
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  doneButtonProminent: {
    backgroundColor: colors.clay,
  },
  doneButtonDisabled: {
    opacity: 0.45,
  },
  doneText: {
    color: colors.paper,
    fontSize: 15,
    fontWeight: "600",
  },
  doneTextProminent: {
    color: colors.paper,
  },
  finishOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(5, 26, 31, 0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  finishCard: {
    backgroundColor: colors.paper,
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 24,
    alignItems: "center",
    minWidth: 240,
  },
  finishTitle: {
    color: colors.forest,
    fontSize: 16,
    fontWeight: "600",
    marginTop: 12,
  },
  finishSubtitle: {
    color: colors.forest,
    fontSize: 13,
    marginTop: 4,
    opacity: 0.7,
  },
  permissionRoot: {
    flex: 1,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  permissionCard: {
    backgroundColor: colors.paper,
    borderRadius: 18,
    padding: 24,
    width: "100%",
    maxWidth: 360,
  },
  permissionTitle: {
    color: colors.forest,
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  permissionBody: {
    color: colors.forest,
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.78,
    marginBottom: 20,
  },
  permissionButton: {
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  permissionPrimary: {
    backgroundColor: colors.clay,
  },
  permissionPrimaryText: {
    color: colors.paper,
    fontSize: 15,
    fontWeight: "600",
  },
  permissionGhost: {
    backgroundColor: "transparent",
  },
  permissionGhostText: {
    color: colors.forest,
    fontSize: 14,
    fontWeight: "500",
  },
});

export default PhotoCaptureScreen;
