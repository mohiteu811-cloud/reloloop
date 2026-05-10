import AsyncStorage from '@react-native-async-storage/async-storage';
import { opacity as bounds } from '@/theme/capture';

const KEY = 'reloloop:overlay-opacity';

export async function loadOpacityPref(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return bounds.default;
    const n = Number(raw);
    if (!Number.isFinite(n)) return bounds.default;
    return clamp(n);
  } catch {
    return bounds.default;
  }
}

export async function saveOpacityPref(value: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(clamp(value)));
  } catch (err) {
    console.warn('[opacityPref] save failed', err);
  }
}

export function clamp(value: number): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}
