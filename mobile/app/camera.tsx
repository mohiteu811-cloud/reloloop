import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>
          LivinLoop needs camera access to capture photos of items you swap.
        </Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant permission</Text>
        </Pressable>
      </View>
    );
  }

  async function capture() {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const result = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        exif: false,
      });
      if (result?.uri) setPhotoUri(result.uri);
    } catch (err) {
      console.warn('[camera] capture failed', err);
    } finally {
      setBusy(false);
    }
  }

  if (photoUri) {
    return (
      <View style={styles.flex}>
        <Image
          source={{ uri: photoUri }}
          style={styles.preview}
          resizeMode="contain"
        />
        <View style={styles.controls}>
          <Pressable
            style={[styles.button, styles.secondary]}
            onPress={() => setPhotoUri(null)}
          >
            <Text style={styles.buttonText}>Retake</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => {
              // Upload wiring lands once auth + the M2 backend's
              // presign endpoint are consumed. For the shell, just
              // pop back to the home screen.
              router.back();
            }}
          >
            <Text style={styles.buttonText}>Use photo</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <CameraView ref={cameraRef} style={styles.flex} facing="back" />
      <View style={styles.controls}>
        <Pressable
          style={[styles.button, busy && styles.disabled]}
          onPress={capture}
          disabled={busy}
        >
          <Text style={styles.buttonText}>{busy ? '…' : 'Capture'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    backgroundColor: '#fff',
  },
  body: { textAlign: 'center', color: '#333', fontSize: 16, lineHeight: 22 },
  preview: { flex: 1, width: '100%', backgroundColor: '#000' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 20,
    paddingHorizontal: 24,
    backgroundColor: '#000',
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  secondary: { backgroundColor: '#ddd' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#111', fontWeight: '600', fontSize: 15 },
});
