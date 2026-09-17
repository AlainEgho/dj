import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CUES } from '../state/presets';
import { director, enqueueCue, playAhead, removeQueued, type CueQueueItem, type Look } from '../stage/director';
import { useRecorder } from './recorder';
import { theme } from './theme';

const ADDABLE = CUES.filter((c) => c.id !== 'auto' && c.id !== 'whiteOut');

interface Snapshot {
  now: CueQueueItem;
  queue: CueQueueItem[];
  progress: number;
  beats: number;
  phraseBeats: number;
}

/**
 * Operator-built upcoming list. Starts empty; the user adds cues.
 * Overlay only — hidden while recording, never drawn on the canvas.
 */
export function CueQueue() {
  const rec = useRecorder();
  const [snap, setSnap] = useState<Snapshot>({
    now: director.now,
    queue: [],
    progress: 0,
    beats: 0,
    phraseBeats: 16,
  });

  useEffect(() => {
    const id = setInterval(() => {
      setSnap({
        now: director.now,
        queue: director.queue.slice(),
        progress: director.phraseProgress,
        beats: director.beatsInPhrase,
        phraseBeats: director.phraseBeats,
      });
    }, 1000 / 8);
    return () => clearInterval(id);
  }, []);

  if (rec.recording || rec.preparing) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>Your queue</Text>
      <View style={styles.now}>
        <Text style={styles.nowTag}>NOW</Text>
        <Text style={styles.nowTitle} numberOfLines={1}>
          {snap.now.label}
        </Text>
        {snap.now.wallLabel ? (
          <Text style={styles.detail} numberOfLines={1}>
            {snap.now.wallLabel}
          </Text>
        ) : null}
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(Math.min(1, snap.progress) * 100)}%` }]} />
        </View>
        <Text style={styles.beats}>
          {snap.phraseBeats > 0 ? `${Math.min(snap.beats, snap.phraseBeats)} / ${snap.phraseBeats}` : ''}
        </Text>
      </View>
      <Text style={styles.nextTag}>NEXT</Text>
      {snap.queue.length === 0 ? (
        <Text style={styles.empty}>Empty — tap a cue below to add it</Text>
      ) : (
        snap.queue.map((item, i) => (
          <View key={`${item.look}-${i}-${item.label}`} style={styles.row}>
            <Text style={styles.idx}>{i + 1}</Text>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.label}
              </Text>
              {item.wallLabel ? (
                <Text style={styles.rowDetail} numberOfLines={1}>
                  {item.wallLabel}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => removeQueued(i)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.remove}>×</Text>
            </Pressable>
          </View>
        ))
      )}
      <Text style={styles.addTag}>ADD</Text>
      <View style={styles.chips}>
        {ADDABLE.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => enqueueCue(c.id as Look)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.chipText}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={() => playAhead()}
        disabled={snap.queue.length === 0}
        accessibilityRole="button"
        style={({ pressed }) => [styles.btn, snap.queue.length === 0 && styles.btnOff, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.btnText}>Play next  ·  Tab</Text>
      </Pressable>
      <Text style={styles.note}>Operator only — not recorded</Text>
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
    width: 228,
    maxHeight: 520,
    gap: 4,
  },
  kicker: { color: theme.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  now: { marginBottom: 6, gap: 2 },
  nowTag: { color: theme.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  nowTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
  detail: { color: theme.textDim, fontSize: 11 },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginTop: 4 },
  fill: { height: 4, backgroundColor: theme.accent },
  beats: { color: theme.textDim, fontSize: 10, fontVariant: ['tabular-nums'] },
  nextTag: { color: theme.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginTop: 4, marginBottom: 2 },
  empty: { color: theme.textDim, fontSize: 11, fontStyle: 'italic', paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 3 },
  idx: { color: theme.textDim, fontSize: 11, width: 14, fontWeight: '700', marginTop: 1 },
  rowText: { flex: 1 },
  rowTitle: { color: theme.text, fontSize: 12, fontWeight: '600' },
  rowDetail: { color: theme.textDim, fontSize: 10 },
  remove: { color: theme.textDim, fontSize: 16, lineHeight: 18, paddingHorizontal: 4 },
  addTag: { color: theme.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginTop: 6, marginBottom: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipText: { color: theme.text, fontSize: 10, fontWeight: '600' },
  btn: {
    marginTop: 8,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: theme.accentSoft,
    borderWidth: 1,
    borderColor: theme.accent,
    alignItems: 'center',
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  note: { color: theme.textDim, fontSize: 9, marginTop: 2 },
});
