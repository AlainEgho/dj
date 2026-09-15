import { useCallback, useRef, useState } from 'react';
import { type GestureResponderEvent, type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { theme } from './theme';

interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

/**
 * Dependency-free slider that works with mouse, touch and pen on every
 * platform via the responder system.
 */
export function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, format }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(widthRef.current);
  };

  const handle = useCallback(
    (e: GestureResponderEvent) => {
      const w = widthRef.current;
      if (w <= 0) return;
      const x = Math.max(0, Math.min(w, e.nativeEvent.locationX));
      let v = min + (x / w) * (max - min);
      v = Math.round(v / step) * step;
      v = Math.max(min, Math.min(max, v));
      onChange(Number(v.toFixed(4)));
    },
    [min, max, step, onChange],
  );

  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const display = format ? format(value) : step >= 1 ? String(Math.round(value)) : value.toFixed(2);

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{display}</Text>
      </View>
      <View
        style={styles.track}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handle}
        onResponderMove={handle}
        onResponderTerminationRequest={() => false}
      >
        <View style={styles.trackBg} />
        <View style={[styles.fill, { width: `${pct}%` }]} />
        <View style={[styles.thumb, { left: Math.max(0, (pct / 100) * width - 9) }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label: { color: theme.text, fontSize: 14 },
  value: { color: theme.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
  track: {
    height: 28,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },
  thumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: theme.accent,
  },
});
