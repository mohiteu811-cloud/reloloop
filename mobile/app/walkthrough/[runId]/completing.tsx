import { useCallback } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { CompletingScreen } from '@/screens/CompletingScreen';

export default function CompletingRoute() {
  const { runId } = useLocalSearchParams<{ runId: string }>();

  const onDone = useCallback(() => {
    router.replace(`/walkthrough/${runId}/summary`);
  }, [runId]);

  const onError = useCallback(
    (err: Error) => {
      Alert.alert(
        'Couldn’t finish',
        err.message ||
          'We’ll keep trying in the background. You can reopen this run from your dashboard.',
        [
          {
            text: 'OK',
            onPress: () => {
              if (router.canGoBack()) router.back();
              else router.replace('/');
            },
          },
        ],
      );
    },
    [],
  );

  if (!runId) return null;
  return <CompletingScreen runId={runId} onDone={onDone} onError={onError} />;
}
