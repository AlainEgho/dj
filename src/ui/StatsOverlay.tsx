import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getAudioFrame, useAudioAnalyzer } from '../audio/useAudioAnalyzer';
import { theme } from './theme';

interface Snapshot {
  bpm: number;
  conf: number;
  amp: number;
  bass: number;
  mid: number;
  treble: number;
  beatEnv: number;
}

/** Small readout of the analyser; polls at 12Hz, independent of the render loop. */
export function StatsOverlay() {
  const { state } = useAudioAnalyzer();
  const [snap, setSnap] = useState<Snapshot>({ bpm: 0, conf: 0, amp: 0, bass: 0, mid: 0, treble: 0, beatEnv: 0 });

  useEffect(() => {
    const id = setInterval(() => {
      const f = getAudioFrame();
      setSnap({
        bpm: f.bpm,
        conf: f.bpmConfidence,
        amp: f.amplitude,
        bass: f.bass,
        mid: f.mid,
        treble: f.treble,
        beatEnv: f.beatEnvelope,
      });
    }, 1000 / 12);
    return () => clearInterval(id);
  }, []);

  const sourceLabel =
    state.source === 'mic' ? 'MIC' : state.source === 'system' ? 'SYSTEM' : state.source === 'file' ? 'TRACK' : 'IDLE';

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.row}>
        <View style={[styles.beat, { opacity: 0.25 + snap.beatEnv * 0.75, transform: [{ scale: 1 + snap.beatEnv * 0.5 }] }]} />
        <Text style={styles.source}>{sourceLabel}</Text>
        <Text style={styles.bpm}>{snap.bpm > 0 && snap.conf > 0.15 ? `${Math.round(snap.bpm)} BPM` : '-- BPM'}</Text>
      </View>
      <Meter label="LVL" v={snap.amp} />
      <Meter label="LOW" v={snap.bass} />
      <Meter label="MID" v={snap.mid} />
      <Meter label="HI" v={snap.treble} />
    </View>
  );
}

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <View style={styles.meterRow}>
      <Text style={styles.meterLabel}>{label}</Text>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.round(Math.min(1, v) * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.panel,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 10,
    width: 190,
    gap: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  beat: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.accent },
  source: { color: theme.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  bpm: { color: theme.text, fontSize: 13, fontWeight: '700', marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meterLabel: { color: theme.textDim, fontSize: 10, width: 28, fontWeight: '600' },
  meterTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  meterFill: { height: 5, backgroundColor: theme.accent },
});
