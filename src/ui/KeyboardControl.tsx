import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KEYMAP, describeKey, findBinding } from './keymap';
import { theme } from './theme';
import { useFullscreen } from './useFullscreen';

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';

/**
 * Laptop-keyboard control surface (web). Mounted once in the root layout so it
 * works on every screen. Shows a short toast for each action and a cheat sheet
 * on "?". Keys are ignored while typing in a text field.
 */
export function KeyboardControl() {
  const [toast, setToast] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef<Set<string>>(new Set());
  const fullscreen = useFullscreen();

  useEffect(() => {
    if (!isWeb) return;
    const flash = (msg: string) => {
      if (!msg) return;
      setToast(msg);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 1300);
    };
    const typing = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA';
    };
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') {
        setShowMap((v) => !v);
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' && showMap) {
        setShowMap(false);
        return;
      }
      if (e.key === 'f' || e.key === 'F') return; // useFullscreen handles it
      const b = findBinding(e);
      if (!b) return;
      e.preventDefault();
      if (b.hold) {
        if (held.current.has(b.key)) return; // key repeat
        held.current.add(b.key);
      } else if (e.repeat && b.group !== 'Levels') {
        return;
      }
      flash(b.run(true));
    };
    const onUp = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const b = findBinding(e);
      if (!b?.hold) return;
      e.preventDefault();
      held.current.delete(b.key);
      flash(b.run(false));
    };
    // capture phase: run before focused buttons swallow Space / Enter
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [showMap]);

  if (!isWeb) return null;

  const groups = Array.from(new Set(KEYMAP.map((b) => b.group)));

  return (
    <>
      {toast ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <Text style={styles.toast}>{toast}</Text>
        </View>
      ) : null}
      {showMap ? (
        <Pressable style={styles.backdrop} onPress={() => setShowMap(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.title}>Keyboard</Text>
              <Text style={styles.note}>Press ? or Esc to close. F toggles fullscreen. {fullscreen.active ? 'Fullscreen on.' : ''}</Text>
            </View>
            <ScrollView contentContainerStyle={styles.columns}>
              {groups.map((g) => (
                <View key={g} style={styles.column}>
                  <Text style={styles.groupTitle}>{g}</Text>
                  {KEYMAP.filter((b) => b.group === g).map((b) => (
                    <View key={`${g}-${describeKey(b)}`} style={styles.row}>
                      <Text style={styles.key}>{describeKey(b)}</Text>
                      <Text style={styles.label}>{b.label}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', top: 24, left: 0, right: 0, alignItems: 'center' },
  toast: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    padding: 24,
    justifyContent: 'center',
  },
  sheet: {
    alignSelf: 'center',
    maxWidth: 1100,
    width: '100%',
    maxHeight: '90%',
    backgroundColor: theme.panelSolid,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
  },
  sheetHeader: { marginBottom: 12 },
  title: { color: theme.text, fontSize: 20, fontWeight: '700' },
  note: { color: theme.textDim, fontSize: 12, marginTop: 4 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  column: { minWidth: 220, flexGrow: 1, flexBasis: 220 },
  groupTitle: { color: theme.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 },
  key: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 92,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: theme.border,
    textAlign: 'center',
  },
  label: { color: theme.textDim, fontSize: 13, flex: 1 },
});
