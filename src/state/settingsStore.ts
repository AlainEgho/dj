/**
 * Minimal external store (no extra dependency) persisted to AsyncStorage.
 * Components subscribe via `useSettings()`; the render loop reads
 * `settingsStore.get()` directly so it never triggers React re-renders.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SETTINGS, SHOW_MODES, type SavedPreset, type ShowMode, type StageSettings } from './presets';

const SETTINGS_KEY = '@stage/settings:v1';
const PRESETS_KEY = '@stage/presets:v1';

type Listener = () => void;

interface StoreState {
  settings: StageSettings;
  presets: SavedPreset[];
  hydrated: boolean;
}

class SettingsStore {
  private state: StoreState = { settings: DEFAULT_SETTINGS, presets: [], hydrated: false };
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.hydrate();
  }

  get = () => this.state;
  getSettings = () => this.state.settings;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private set(partial: Partial<StoreState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private async hydrate() {
    try {
      const [s, p] = await Promise.all([AsyncStorage.getItem(SETTINGS_KEY), AsyncStorage.getItem(PRESETS_KEY)]);
      const settings = s ? { ...DEFAULT_SETTINGS, ...(JSON.parse(s) as Partial<StageSettings>) } : DEFAULT_SETTINGS;
      // a held blackout must never survive a reload
      settings.blackout = false;
      const presets = p ? (JSON.parse(p) as SavedPreset[]) : [];
      this.set({ settings, presets, hydrated: true });
    } catch {
      this.set({ hydrated: true });
    }
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(this.state.settings)).catch(() => {});
    }, 300);
  }

  update(partial: Partial<StageSettings>) {
    const next = { ...this.state.settings, ...partial };
    // any manual tweak moves us out of a named show mode
    if (!('showMode' in partial)) next.showMode = 'custom';
    this.set({ settings: next });
    this.scheduleSave();
  }

  applyShowMode(mode: ShowMode) {
    if (mode === 'custom') {
      this.update({ showMode: 'custom' });
      return;
    }
    this.set({ settings: { ...this.state.settings, ...SHOW_MODES[mode], showMode: mode } });
    this.scheduleSave();
  }

  reset() {
    this.set({ settings: DEFAULT_SETTINGS });
    this.scheduleSave();
  }

  async savePreset(name: string) {
    const preset: SavedPreset = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || `Preset ${this.state.presets.length + 1}`,
      createdAt: Date.now(),
      settings: this.state.settings,
    };
    const presets = [preset, ...this.state.presets].slice(0, 30);
    this.set({ presets });
    await AsyncStorage.setItem(PRESETS_KEY, JSON.stringify(presets)).catch(() => {});
  }

  loadPreset(id: string) {
    const p = this.state.presets.find((x) => x.id === id);
    if (!p) return;
    this.set({ settings: { ...DEFAULT_SETTINGS, ...p.settings } });
    this.scheduleSave();
  }

  async deletePreset(id: string) {
    const presets = this.state.presets.filter((x) => x.id !== id);
    this.set({ presets });
    await AsyncStorage.setItem(PRESETS_KEY, JSON.stringify(presets)).catch(() => {});
  }
}

export const settingsStore = new SettingsStore();

export function useSettings(): StageSettings {
  return useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get().settings, () => DEFAULT_SETTINGS);
}

export function usePresets(): SavedPreset[] {
  return useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get().presets, () => []);
}
