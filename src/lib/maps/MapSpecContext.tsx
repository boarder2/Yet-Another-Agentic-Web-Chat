'use client';

import { createContext, useContext } from 'react';
import type { MapSessionOverlay, PersistableMapSpec } from './types';

export interface MapSpecContextValue {
  /** Exact private canonical map lookup used by writer-owned envelopes. */
  getMapSpecById: (mapId: string) => PersistableMapSpec | undefined;
  /** Live-only precise overlay lookup; never populated from durable metadata. */
  getMapSessionOverlayById?: (mapId: string) => MapSessionOverlay | undefined;
}

export const MapSpecContext = createContext<MapSpecContextValue>({
  getMapSpecById: () => undefined,
});

export function useMapSpecById(mapId: string): PersistableMapSpec | undefined {
  return useContext(MapSpecContext).getMapSpecById(mapId);
}

export function useMapSessionOverlayById(
  mapId: string,
): MapSessionOverlay | undefined {
  return useContext(MapSpecContext).getMapSessionOverlayById?.(mapId);
}

export default MapSpecContext;
