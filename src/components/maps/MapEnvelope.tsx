'use client';

import type { MapPayload } from '@/lib/widgets/envelope';
import {
  useMapSessionOverlayById,
  useMapSpecById,
} from '@/lib/maps/MapSpecContext';
import MapWidget from './MapWidget';

/** Renders a writer-owned map placement by its exact private map ID. */
export default function MapEnvelope({ payload }: { payload: MapPayload }) {
  const spec = useMapSpecById(payload.mapId);
  const overlay = useMapSessionOverlayById(payload.mapId);
  // A guessed/private ID must not make an arbitrary payload render as a map.
  if (!spec) return null;
  const title = spec.title || payload.title || 'Map';
  return (
    <section data-map-envelope aria-label={title} className="my-3 text-sm">
      <MapWidget spec={spec} title={title} overlay={overlay} />
    </section>
  );
}
