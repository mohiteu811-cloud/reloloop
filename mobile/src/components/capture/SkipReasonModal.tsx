import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureTheme } from '@/theme/capture';
import { SKIP_REASONS, type SkipReason } from '@/types/walkthrough';

type Props = {
  visible: boolean;
  shotName: string;
  required: boolean;
  onCancel: () => void;
  onConfirm: (reason: SkipReason, note?: string) => void;
};

export function SkipReasonModal({
  visible,
  shotName,
  required,
  onCancel,
  onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<SkipReason | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible) {
      setReason(null);
      setNote('');
    }
  }, [visible]);

  const canConfirm =
    reason !== null && (reason !== 'other' || note.trim().length > 0);

  const handleConfirm = () => {
    if (!canConfirm || reason === null) return;
    onConfirm(reason, note.trim() ? note.trim() : undefined);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={styles.scrim} onPress={onCancel} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kbWrap}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 12) + 12 },
          ]}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Why skip this shot?</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {shotName}
            {required ? '  ·  required' : ''}
          </Text>

          <View style={styles.options}>
            {SKIP_REASONS.map((opt) => {
              const selected = reason === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setReason(opt.value)}
                  style={({ pressed }) => [
                    styles.option,
                    selected && styles.optionSelected,
                    pressed && !selected && styles.optionPressed,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <View
                    style={[styles.radio, selected && styles.radioSelected]}
                  />
                  <Text
                    style={[
                      styles.optionText,
                      selected && styles.optionTextSelected,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {reason === 'other' && (
            <TextInput
              style={styles.input}
              placeholder="What's going on?"
              placeholderTextColor={captureTheme.textFaint}
              keyboardAppearance="dark"
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={140}
              autoFocus
            />
          )}

          {required && reason !== null && (
            <Text style={styles.flag}>
              This shot is required. The host will see it as flagged in the run summary.
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                pressed && styles.btnPressed,
              ]}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={!canConfirm}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                !canConfirm && styles.btnDisabled,
                pressed && canConfirm && styles.btnPressed,
              ]}
            >
              <Text style={styles.btnPrimaryText}>Skip shot</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  kbWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1A1A1C',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginBottom: 14,
  },
  title: {
    color: captureTheme.text,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  subtitle: {
    color: captureTheme.textDim,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 14,
  },
  options: {
    gap: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionPressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  optionSelected: {
    backgroundColor: 'rgba(91,208,160,0.10)',
    borderColor: captureTheme.ok,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: captureTheme.textFaint,
  },
  radioSelected: {
    borderColor: captureTheme.ok,
    backgroundColor: captureTheme.ok,
  },
  optionText: {
    color: captureTheme.text,
    fontSize: 15,
    fontWeight: '500',
  },
  optionTextSelected: { color: captureTheme.text },
  input: {
    marginTop: 12,
    minHeight: 64,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: captureTheme.pillBorder,
    color: captureTheme.text,
    fontSize: 14,
    padding: 12,
    textAlignVertical: 'top',
  },
  flag: {
    marginTop: 12,
    color: captureTheme.danger,
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { opacity: 0.7 },
  btnDisabled: { opacity: 0.4 },
  btnGhost: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: captureTheme.pillBorder,
  },
  btnGhostText: {
    color: captureTheme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  btnPrimary: { backgroundColor: captureTheme.text },
  btnPrimaryText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
