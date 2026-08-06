'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const WIDTH_KEY = 'artifactPanelWidth';
const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 320;
/**
 * Leave the chat column usable no matter how far the handle is dragged —
 * 525px of chat plus the workspace sidebar's collapsed rail, which a workspace
 * chat always pays for (the composer's send button spills out below that).
 */
const MIN_CHAT_WIDTH = 525 + 64;
/** `<main>`'s `lg:pl-20` sidebar rail, which is not chat. */
const RAIL_WIDTH = 80;

export interface ArtifactPanelState {
  artifactId: string | null;
  version?: number;
  isResizing: boolean;
  open: (artifactId: string, version?: number) => void;
  close: () => void;
  startResize: (e: React.PointerEvent<HTMLElement>) => void;
}

const maxWidth = () => {
  const rail = window.matchMedia('(min-width: 1024px)').matches
    ? RAIL_WIDTH
    : 0;
  return Math.max(MIN_WIDTH, window.innerWidth - MIN_CHAT_WIDTH - rail);
};

const clamp = (width: number) =>
  Math.min(maxWidth(), Math.max(MIN_WIDTH, width));

const setInset = (width: number) =>
  document.documentElement.style.setProperty('--artifact-inset', `${width}px`);

/**
 * Owns which artifact the viewer shows and how much of the viewport it claims.
 * The width is published as a `:root` custom property rather than React state:
 * `<main>` reserves it, the chat column stops centring, and the viewport-fixed
 * chat chrome shifts off it — none of which needs a render, so a drag repaints
 * without re-rendering the conversation. The width is a device-local
 * preference, so it lives in localStorage rather than the DB.
 */
export function useArtifactPanel(): ArtifactPanelState {
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [version, setVersion] = useState<number | undefined>();
  const [isResizing, setIsResizing] = useState(false);
  // The stored preference, unclamped: a width set on a wide screen survives
  // being opened on a narrow one.
  const widthRef = useRef<number | null>(null);

  const open = useCallback((id: string, v?: number) => {
    setArtifactId(id);
    setVersion(v);
  }, []);

  const close = useCallback(() => setArtifactId(null), []);

  useEffect(() => {
    if (!artifactId) return;
    const root = document.documentElement;
    if (widthRef.current === null) {
      const stored = Number(localStorage.getItem(WIDTH_KEY));
      widthRef.current =
        Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
    }
    // Re-clamped on resize as well as on open, so shrinking the window can
    // never squeeze the chat below its minimum.
    const apply = () => setInset(clamp(widthRef.current!));
    apply();
    root.style.setProperty('--chat-ml', '1rem');
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      root.style.removeProperty('--artifact-inset');
      root.style.removeProperty('--chat-ml');
    };
  }, [artifactId]);

  const startResize = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    setIsResizing(true);
    // Capture on the handle, not the window: the drag crosses the artifact
    // iframe, which would otherwise swallow the move/up events and leave the
    // splitter stuck to the cursor. Capture is released implicitly on up.
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      widthRef.current = clamp(window.innerWidth - ev.clientX);
      setInset(widthRef.current);
    };
    const onUp = () => {
      setIsResizing(false);
      localStorage.setItem(WIDTH_KEY, String(widthRef.current));
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, []);

  return { artifactId, version, isResizing, open, close, startResize };
}
