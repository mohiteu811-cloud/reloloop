import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { CaptureScreen } from '@/screens/CaptureScreen';
import { fetchRun } from '@/lib/api/walkthroughRuns';
import { DEMO_RUN } from '@/lib/demoRun';
import { captureTheme } from '@/theme/capture';
import type { WalkthroughRun } from '@/types/walkthrough';

export default function WalkthroughCaptureRoute() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const [run, setRun] = useState<WalkthroughRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!runId) return;
    if (runId === 'demo') {
      setRun(DEMO_RUN);
      return;
    }
    (async () => {
      try {
        const next = await fetchRun(runId);
        if (!cancelled) setRun(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load walkthrough');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const onExit = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const onComplete = useCallback(() => {
    router.replace(`/walkthrough/${runId}/completing`);
  }, [runId]);

  useEffect(() => {
    if (error) {
      Alert.alert('Walkthrough', error, [{ text: 'OK', onPress: onExit }]);
    }
  }, [error, onExit]);

  if (!run) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={captureTheme.text} />
      </View>
    );
  }

  return <CaptureScreen run={run} onExit={onExit} onComplete={onComplete} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: captureTheme.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
