import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioAnalyzer } from '../audio/useAudioAnalyzer';
import { Slider } from './Slider';
import { theme } from './theme';
import { useFullscreen } from './useFullscreen';

function fmtTime(s: number) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface BtnProps {
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'accent' | 'danger';
}

export function Btn({ label, onPress, active, disabled, tone = 'default' }: BtnProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        active && styles.btnActive,
        tone === 'accent' && styles.btnAccent,
        tone === 'danger' && styles.btnDanger,
        disabled && styles.btnDisabled,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.btnText, active && styles.btnTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Source selection, transport and navigation. Shown as the bottom overlay. */
export function ControlBar() {
  const { state, controls } = useAudioAnalyzer();
  const router = useRouter();
  const fullscreen = useFullscreen();
  const isFile = state.source === 'file';

  return (
    <View style={styles.wrap}>
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      {isFile && state.duration > 0 ? (
        <View style={styles.seekRow}>
          <Slider
            label={state.fileName ?? 'Track'}
            value={state.position}
            min={0}
            max={state.duration}
            step={0.5}
            onChange={controls.seek}
            format={(v) => `${fmtTime(v)} / ${fmtTime(state.duration)}`}
          />
        </View>
      ) : null}
      <View style={styles.row}>
        <Btn label="Mic" active={state.source === 'mic'} onPress={controls.startMic} disabled={!state.capabilities.mic} />
        {state.capabilities.system ? (
          <Btn label="System audio" active={state.source === 'system'} onPress={controls.startSystemAudio} />
        ) : null}
        <Btn label={isFile ? 'Change track' : 'Load track'} active={isFile} onPress={controls.loadFile} />
        {isFile ? (
          <Btn label={state.playing ? 'Pause' : 'Play'} tone="accent" onPress={state.playing ? controls.pause : controls.play} />
        ) : null}
        {state.source !== 'none' ? <Btn label="Stop" tone="danger" onPress={controls.stop} /> : null}
        <View style={styles.spacer} />
        <Btn label="Settings" onPress={() => router.push('/settings')} />
        {fullscreen.supported ? (
          <Btn label={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'} active={fullscreen.active} onPress={fullscreen.toggle} />
        ) : null}
        {Platform.OS === 'web' ? (
          <Btn
            label="Keys ?"
            onPress={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }))}
          />
        ) : null}
        <Btn label="Projection" tone="accent" onPress={() => router.push('/projection')} />
      </View>
      {state.source === 'none' ? (
        <Text style={styles.hint}>
          {Platform.OS === 'web'
            ? 'Pick a source: microphone, share a tab/system audio, or load a track.'
            : 'Pick a source: microphone or load a track from your files.'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.panel,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    gap: 8,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  spacer: { flexGrow: 1 },
  seekRow: { marginBottom: -8 },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  btnActive: { backgroundColor: theme.accentSoft, borderColor: theme.accent },
  btnAccent: { backgroundColor: theme.accent, borderColor: theme.accent },
  btnDanger: { backgroundColor: 'rgba(255,92,122,0.18)', borderColor: theme.danger },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  btnTextActive: { color: '#fff' },
  error: { color: theme.danger, fontSize: 13 },
  hint: { color: theme.textDim, fontSize: 12 },
});
