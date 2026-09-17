import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stage } from '../src/stage/Stage';
import { ControlBar } from '../src/ui/ControlBar';
import { CueQueue } from '../src/ui/CueQueue';
import { StatsOverlay } from '../src/ui/StatsOverlay';
import { onStageTap } from '../src/ui/chromeBus';

/** Main screen: full-bleed stage with overlay chrome. Tap the stage to hide/show UI. */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [chrome, setChrome] = useState(true);

  useEffect(() => onStageTap(() => setChrome((c) => !c)), []);

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill}>
        <Stage />
      </View>
      {chrome ? (
        <>
          <View style={[styles.top, { top: insets.top + 12, left: insets.left + 12 }]}>
            <StatsOverlay />
          </View>
          <View style={[styles.queue, { top: insets.top + 12, right: insets.right + 12 }]}>
            <CueQueue />
          </View>
          <View style={[styles.bottom, { bottom: insets.bottom + 12, left: insets.left + 12, right: insets.right + 12 }]}>
            <ControlBar />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute' },
  queue: { position: 'absolute' },
  bottom: { position: 'absolute' },
});
