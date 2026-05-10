import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { completeRun } from '@/lib/api/walkthroughRuns';
import { clearProgress } from '@/state/runProgress';
import { uploadQueue, type UploadQueueState } from '@/lib/uploadQueue';
import { captureTheme } from '@/theme/capture';

type Props = {
  runId: string;
  onDone: () => void;
  onError: (err: Error) => void;
};

export function CompletingScreen({ runId, onDone, onError }: Props) {
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<UploadQueueState>(uploadQueue.getState());
  const [phase, setPhase] = useState<'uploading' | 'finalizing' | 'done'>(
    'uploading',
  );

  useEffect(() => {
    return uploadQueue.subscribe(setQueue);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await uploadQueue.drain(runId);
        if (cancelled) return;
        setPhase('finalizing');
        await completeRun(runId);
        if (cancelled) return;
        await clearProgress(runId);
        if (cancelled) return;
        setPhase('done');
        onDone();
      } catch (err) {
        if (cancelled) return;
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, onDone, onError]);

  const headline =
    phase === 'finalizing'
      ? 'Wrapping up'
      : phase === 'done'
        ? 'All set'
        : 'Uploading photos';

  const sub =
    phase === 'finalizing'
      ? 'Sending the run to the host.'
      : phase === 'done'
        ? 'Loading your run summary…'
        : queue.pending + queue.uploading > 0
          ? `${queue.pending + queue.uploading} photo${queue.pending + queue.uploading === 1 ? '' : 's'} left`
          : 'Almost done…';

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.body}>
        <ActivityIndicator color={captureTheme.text} size="large" />
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.sub}>{sub}</Text>
        {queue.failed > 0 && (
          <Text style={styles.warn}>
            {queue.failed} photo{queue.failed === 1 ? '' : 's'} couldn’t upload yet — we’ll keep
            retrying in the background.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: captureTheme.bg,
    paddingHorizontal: 28,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  headline: {
    color: captureTheme.text,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.1,
    marginTop: 6,
  },
  sub: {
    color: captureTheme.textDim,
    fontSize: 15,
    textAlign: 'center',
    maxWidth: 320,
  },
  warn: {
    marginTop: 16,
    color: captureTheme.danger,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 320,
  },
});
