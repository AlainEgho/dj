import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stage } from '../src/stage/Stage';
import { theme } from '../src/ui/theme';
import { useFullscreen } from '../src/ui/useFullscreen';

/**
 * Projection mode: the stage only, no chrome. Keeps the screen awake, hides
 * the status bar and, on web, goes fullscreen. Tap once to reveal a temporary
 * exit button; press Escape or F to leave browser fullscreen.
 */
export default function ProjectionScreen() {
  useKeepAwake();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const fullscreen = useFullscreen();
  const [showExit, setShowExit] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fullscreen.enter();
    return () => fullscreen.exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reveal = () => {
    setShowExit(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShowExit(false), 3000);
  };

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <View style={StyleSheet.absoluteFill}>
        <Stage />
      </View>
      <Pressable style={StyleSheet.absoluteFill} onPress={reveal} />
      {showExit ? (
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={[styles.exit, { top: insets.top + 16, right: insets.right + 16 }]}
        >
          <Text style={styles.exitText}>Exit projection</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  exit: {
    position: 'absolute',
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  exitText: { color: theme.text, fontWeight: '600' },
});
