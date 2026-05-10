import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Alert, View } from "react-native";

import PhotoCaptureScreen from "@/screens/PhotoCaptureScreen";
import type { Walkthrough } from "@/types";

export default function App() {
  const [done, setDone] = useState<Walkthrough | null>(null);

  if (done) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: "#051A1F" }} />
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <PhotoCaptureScreen
        propertyId="prop_demo"
        propertyName="14 Jellicoe Street"
        walkthroughType="MOVE_IN"
        onComplete={(walkthrough) => {
          setDone(walkthrough);
          Alert.alert("Walkthrough complete", walkthrough.id);
        }}
        onCancel={() => {
          Alert.alert("Cancelled");
        }}
      />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
