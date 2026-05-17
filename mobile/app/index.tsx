import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>LivinLoop</Text>
      <Text style={styles.sub}>Mobile shell — v0.1.0</Text>
      <Link href="/camera" style={styles.cta}>
        Open camera
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  title: { fontSize: 32, fontWeight: '600' },
  sub: { color: '#666', marginBottom: 32 },
  cta: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: '#111',
    color: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
    fontWeight: '600',
  },
});
