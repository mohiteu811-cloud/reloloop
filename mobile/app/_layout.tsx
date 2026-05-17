import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#fff' },
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#fff' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'LivinLoop' }} />
        <Stack.Screen name="camera" options={{ title: 'Capture photo' }} />
      </Stack>
    </>
  );
}
