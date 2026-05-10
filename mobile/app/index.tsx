import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { captureTheme } from '@/theme/capture';

export default function Home() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>ReloLoop</Text>
      <Text style={styles.copy}>
        Mobile shell. The walkthrough capture flow lives at
        {'\n'}
        <Text style={styles.code}>/walkthrough/[runId]</Text>.
      </Text>
      <Pressable
        onPress={() => router.push('/walkthrough/demo')}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      >
        <Text style={styles.btnText}>Open demo capture</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: captureTheme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 16,
  },
  title: {
    color: captureTheme.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  copy: {
    color: captureTheme.textDim,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  code: {
    color: captureTheme.text,
    fontFamily: 'Menlo',
    fontSize: 13,
  },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: captureTheme.text,
    marginTop: 8,
  },
  pressed: { opacity: 0.7 },
  btnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
