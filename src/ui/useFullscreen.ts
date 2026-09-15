import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

const hasDoc = () => Platform.OS === 'web' && typeof document !== 'undefined';

/** Browser fullscreen helper. On native it reports unsupported and does nothing. */
export function useFullscreen() {
  const [active, setActive] = useState(() => (hasDoc() ? !!document.fullscreenElement : false));
  const supported = hasDoc() && !!document.documentElement.requestFullscreen;

  useEffect(() => {
    if (!hasDoc()) return;
    const onChange = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enter = useCallback(() => {
    if (!supported) return;
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, [supported]);

  const exit = useCallback(() => {
    if (hasDoc() && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    if (active) exit();
    else enter();
  }, [active, enter, exit]);

  // Keyboard shortcut: F toggles fullscreen (ignored while typing in an input)
  useEffect(() => {
    if (!hasDoc()) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'f' || e.key === 'F') toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { supported, active, enter, exit, toggle };
}
