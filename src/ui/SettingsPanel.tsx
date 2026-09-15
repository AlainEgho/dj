import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { PALETTES, hslToHex } from '../state/palettes';
import {
  CUES,
  GENRES,
  LASER_COLORS,
  RIG_STYLES,
  WALL_SHAPES,
  type ShowMode,
  type StageSettings,
  type WallMode,
} from '../state/presets';
import { settingsStore, usePresets, useSettings } from '../state/settingsStore';
import { Btn } from './ControlBar';
import { Slider } from './Slider';
import { theme } from './theme';
import { KEYMAP, describeKey } from './keymap';
import { RECORD_QUALITIES } from './recorder';

const MODES: { id: ShowMode; label: string; blurb: string }[] = [
  { id: 'chill', label: 'Chill', blurb: 'Slow sweeps, no strobes' },
  { id: 'festival', label: 'Festival', blurb: 'Balanced main-stage look' },
  { id: 'rave', label: 'Rave', blurb: 'Everything, all the time' },
];

const WALL_MODES: { id: WallMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'heatmap', label: 'Heat map' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'text', label: 'Text' },
  { id: 'off', label: 'Off' },
];

const TOGGLES: { key: keyof StageSettings; label: string }[] = [
  { key: 'lasersEnabled', label: 'Lasers' },
  { key: 'beamsEnabled', label: 'Moving heads' },
  { key: 'strobeEnabled', label: 'Strobes' },
  { key: 'washEnabled', label: 'White wash' },
  { key: 'pyroEnabled', label: 'Pyro' },
  { key: 'ledEnabled', label: 'LED wall' },
  { key: 'hazeEnabled', label: 'Haze' },
];

export function SettingsPanel() {
  const s = useSettings();
  const presets = usePresets();
  const [presetName, setPresetName] = useState('');
  const set = (p: Partial<StageSettings>) => settingsStore.update(p);

  return (
    <View style={styles.wrap}>
      <Section title="Show mode">
        <View style={styles.chips}>
          {MODES.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => settingsStore.applyShowMode(m.id)}
              style={[styles.modeChip, s.showMode === m.id && styles.chipActive]}
            >
              <Text style={styles.chipTitle}>{m.label}</Text>
              <Text style={styles.chipBlurb}>{m.blurb}</Text>
            </Pressable>
          ))}
        </View>
        {s.showMode === 'custom' ? <Text style={styles.note}>Custom (edited)</Text> : null}
      </Section>

      <Section title="Colour palette">
        <View style={styles.chips}>
          {PALETTES.map((p) => {
            const hue = p.id === 'custom' ? s.customHue : p.hue;
            const swatch = p.id === 'auto' ? theme.accent : hslToHex(hue / 360, Math.max(0.15, p.saturation), 0.55);
            return (
              <Pressable
                key={p.id}
                onPress={() => set({ paletteId: p.id })}
                style={[styles.paletteChip, s.paletteId === p.id && styles.chipActive]}
              >
                <View style={[styles.swatch, { backgroundColor: swatch }]} />
                <Text style={styles.chipTitle}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
        {s.paletteId === 'custom' ? (
          <Slider label="Base hue" value={s.customHue} min={0} max={360} step={1} onChange={(v) => set({ customHue: v })} format={(v) => `${Math.round(v)}°`} />
        ) : null}
        <Slider label="Hue cycling (per beat)" value={s.hueCycleSpeed} onChange={(v) => set({ hueCycleSpeed: v })} />
      </Section>

      <Section title="Music profile">
        <View style={styles.chips}>
          {GENRES.map((g) => (
            <Pressable
              key={g.id}
              onPress={() => set({ genre: g.id })}
              style={[styles.modeChip, s.genre === g.id && styles.chipActive]}
            >
              <Text style={styles.chipTitle}>{g.label}</Text>
              <Text style={styles.chipBlurb}>{g.blurb}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>
          Tunes the tempo range, phrase length, and how breakdowns, build-ups and drops are recognised. Trance holds 32-beat
          phrases, rests the lasers through a breakdown and waits for a real drop.
        </Text>
      </Section>

      <Section title="Show pacing">
        <Slider
          label="Pacing"
          value={s.pacing}
          onChange={(v) => set({ pacing: v })}
          format={(v) => (v < 0.3 ? 'Cinematic' : v < 0.6 ? 'Festival' : 'Club')}
        />
        <Text style={[styles.note, { marginBottom: 6 }]}>Rig style</Text>
        <View style={styles.chips}>
          {RIG_STYLES.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => set({ rigStyle: r.id })}
              style={[styles.paletteChip, s.rigStyle === r.id && styles.chipActive]}
            >
              <Text style={styles.chipTitle}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.note, { marginBottom: 8 }]}>
          Festival: lasers on the truss and floor, beams and lasers together. Arena: floor lasers only, one element at a time.
          Mix: both.
        </Text>
        <Text style={[styles.note, { marginBottom: 6 }]}>Cue</Text>
        <View style={styles.chips}>
          {CUES.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => set({ cue: c.id })}
              style={[styles.paletteChip, s.cue === c.id && styles.chipActive]}
            >
              <Text style={styles.chipTitle}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Auto cues</Text>
            <Text style={styles.note}>Change looks every phrase: wall, beams, laser sweeps, laser mesh, blackouts</Text>
          </View>
          <Switch
            value={s.autoCues}
            onValueChange={(v) => set({ autoCues: v })}
            trackColor={{ true: theme.accent, false: 'rgba(255,255,255,0.2)' }}
            thumbColor="#fff"
          />
        </View>
      </Section>

      <Section title="LED wall">
        <View style={styles.chips}>
          {WALL_MODES.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => set({ wallMode: m.id })}
              style={[styles.paletteChip, s.wallMode === m.id && styles.chipActive]}
            >
              <Text style={styles.chipTitle}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        {s.wallMode === 'shapes' ? (
          <View style={styles.chips}>
            {WALL_SHAPES.map((sh) => (
              <Pressable
                key={sh.id}
                onPress={() => set({ wallShape: sh.id })}
                style={[styles.paletteChip, s.wallShape === sh.id && styles.chipActive]}
              >
                <Text style={styles.chipTitle}>{sh.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <TextInput
          value={s.wallText}
          onChangeText={(v) => set({ wallText: v.slice(0, 200) })}
          placeholder="Words, comma separated: ANYMA, AFTERLIFE, A, B"
          placeholderTextColor={theme.textDim}
          autoCapitalize="characters"
          style={styles.input}
        />
        <Text style={styles.note}>
          Each word up to 13 characters, typed in letter by letter. In Auto mode a random word appears on some wall phrases;
          in Text mode the words rotate.
        </Text>
      </Section>

      <Section title="Intensity">
        <Slider label="Effect intensity" value={s.intensity} onChange={(v) => set({ intensity: v })} />
        <Slider
          label="Audio sensitivity"
          value={s.sensitivity}
          onChange={(v) => set({ sensitivity: v })}
          format={(v) => (v < 0.33 ? 'Low (loud rooms)' : v < 0.66 ? 'Normal' : 'High (quiet source)')}
        />
        <Slider label="Audio reactivity" value={s.reactivity} onChange={(v) => set({ reactivity: v })} />
        <Slider
          label="Laser sensitivity"
          value={s.laserSensitivity}
          onChange={(v) => set({ laserSensitivity: v })}
          format={(v) => (v < 0.15 ? 'Steady (ignores audio)' : v < 0.5 ? 'Gentle' : v < 0.8 ? 'Normal' : 'Punchy')}
        />
        <Slider
          label="Beam sensitivity"
          value={s.beamSensitivity}
          onChange={(v) => set({ beamSensitivity: v })}
          format={(v) => (v < 0.15 ? 'Steady (ignores audio)' : v < 0.5 ? 'Gentle' : v < 0.8 ? 'Normal' : 'Punchy')}
        />
        <Slider
          label="Strobe sensitivity"
          value={s.strobeSensitivity}
          onChange={(v) => set({ strobeSensitivity: v })}
          format={(v) => (v < 0.15 ? 'Off unless cued' : v < 0.5 ? 'Rare' : v < 0.8 ? 'Normal' : 'Eager')}
        />
        <Text style={[styles.note, { marginBottom: 8 }]}>
          How hard each family follows the track. During speech or any beatless passage both ease off on their own and the
          heads open to the crowd.
        </Text>
        <Slider label="Laser density" value={s.laserDensity} onChange={(v) => set({ laserDensity: v })} />
        <Text style={[styles.note, { marginBottom: 6 }]}>Laser colour</Text>
        <View style={styles.chips}>
          {LASER_COLORS.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => set({ laserColor: c.id })}
              style={[styles.paletteChip, s.laserColor === c.id && styles.chipActive]}
            >
              {c.id === 'rainbow' ? (
                <View style={styles.rainbowSwatch}>
                  {['#ff1f1a', '#ffeb40', '#33ff4d', '#38b6ff', '#ff26cc'].map((h) => (
                    <View key={h} style={{ flex: 1, backgroundColor: h }} />
                  ))}
                </View>
              ) : (
                <View style={[styles.swatch, { backgroundColor: c.rgb ? rgbToHex(c.rgb) : theme.accent }]} />
              )}
              <Text style={styles.chipTitle}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
        <Slider label="Moving heads" value={s.beamCount} min={4} max={24} step={1} onChange={(v) => set({ beamCount: v })} />
      </Section>

      <Section title="Elements">
        {TOGGLES.map((t) => (
          <View key={t.key} style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>{t.label}</Text>
            <Switch
              value={Boolean(s[t.key])}
              onValueChange={(v) => set({ [t.key]: v } as Partial<StageSettings>)}
              trackColor={{ true: theme.accent, false: 'rgba(255,255,255,0.2)' }}
              thumbColor="#fff"
            />
          </View>
        ))}
      </Section>

      {Platform.OS === 'web' ? (
        <Section title="Recording">
          <Text style={[styles.note, { marginBottom: 6 }]}>Resolution while recording</Text>
          <View style={styles.chips}>
            {(Object.keys(RECORD_QUALITIES) as StageSettings['recordQuality'][]).map((q) => (
              <Pressable
                key={q}
                onPress={() => set({ recordQuality: q })}
                style={[styles.paletteChip, s.recordQuality === q && styles.chipActive]}
              >
                <Text style={styles.chipTitle}>{RECORD_QUALITIES[q].label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>
            The stage renders at this height only while recording, then drops back. 1440p and 4K need a strong GPU to hold 60 fps.
            Files are MP4 (H.264 + AAC) where the browser supports it.
          </Text>
        </Section>
      ) : null}

      {Platform.OS === 'web' ? (
        <Section title="Keyboard">
          <Text style={[styles.note, { marginBottom: 8 }]}>
            Every function has a key. Press ? on the stage for the overlay. Keys are ignored while typing here.
          </Text>
          {Array.from(new Set(KEYMAP.map((b) => b.group))).map((g) => (
            <View key={g} style={{ marginBottom: 8 }}>
              <Text style={[styles.note, { color: theme.accent, fontWeight: '700', marginBottom: 4 }]}>{g}</Text>
              {KEYMAP.filter((b) => b.group === g).map((b) => (
                <View key={`${g}-${describeKey(b)}`} style={styles.keyRow}>
                  <Text style={styles.keyCap}>{describeKey(b)}</Text>
                  <Text style={styles.note}>{b.label}</Text>
                </View>
              ))}
            </View>
          ))}
        </Section>
      ) : null}

      <Section title="Presets">
        <View style={styles.presetSave}>
          <TextInput
            value={presetName}
            onChangeText={setPresetName}
            placeholder="Preset name"
            placeholderTextColor={theme.textDim}
            style={styles.input}
          />
          <Btn
            label="Save current"
            tone="accent"
            onPress={() => {
              void settingsStore.savePreset(presetName);
              setPresetName('');
            }}
          />
        </View>
        {presets.length === 0 ? <Text style={styles.note}>No saved presets yet.</Text> : null}
        {presets.map((p) => (
          <View key={p.id} style={styles.presetRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.presetName}>{p.name}</Text>
              <Text style={styles.note}>{new Date(p.createdAt).toLocaleString()}</Text>
            </View>
            <Btn label="Load" onPress={() => settingsStore.loadPreset(p.id)} />
            <Btn label="Delete" tone="danger" onPress={() => void settingsStore.deletePreset(p.id)} />
          </View>
        ))}
        <View style={{ marginTop: 8 }}>
          <Btn label="Reset to defaults" onPress={() => settingsStore.reset()} />
        </View>
      </Section>
    </View>
  );
}

const rgbToHex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  section: {
    backgroundColor: theme.panel,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
  },
  sectionTitle: { color: theme.textDim, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  modeChip: {
    flexGrow: 1,
    minWidth: 120,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  paletteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipActive: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  chipTitle: { color: theme.text, fontSize: 14, fontWeight: '600' },
  chipBlurb: { color: theme.textDim, fontSize: 11, marginTop: 2 },
  swatch: { width: 16, height: 16, borderRadius: 8 },
  rainbowSwatch: { width: 16, height: 16, borderRadius: 8, overflow: 'hidden', flexDirection: 'row' },
  note: { color: theme.textDim, fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  toggleLabel: { color: theme.text, fontSize: 14 },
  presetSave: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 },
  input: {
    flex: 1,
    color: theme.text,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  keyCap: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 96,
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  presetName: { color: theme.text, fontSize: 14, fontWeight: '600' },
});
