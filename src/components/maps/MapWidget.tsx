'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { Card } from '@/components/ui/Card';
import { useMappingConfig } from '@/lib/hooks/api/useMapping';
import {
  MappingClientConfigSchema,
  type MappingClientConfig,
} from '@/lib/maps/config';
import {
  MapSessionOverlaySchema,
  PersistableMapSpecSchema,
  type MapCoordinate,
  type MapPlace,
  type MapRoute,
  type MapSessionOverlay,
  type PersistableMapRoute,
  type PersistableMapSpec,
} from '@/lib/maps/types';
import { formatMapRouteSummary, mapSpecLinks } from '@/lib/maps/presentation';

export interface MapWidgetProps {
  spec: PersistableMapSpec;
  title?: string;
  overlay?: MapSessionOverlay;
}

type MapRenderStatus = 'idle' | 'loading' | 'ready' | 'error' | 'tile-error';

type DisplayRoute = MapRoute | PersistableMapRoute;

interface MapRenderData {
  bounds: Array<[number, number]>;
  route?: MapRoute;
  routeDestination?: MapCoordinate;
  origin?: MapCoordinate;
  originIsPersisted?: boolean;
}

function isFullRoute(route: DisplayRoute | undefined): route is MapRoute {
  return route !== undefined && 'geometry' in route;
}

function isRedactedRoute(route: DisplayRoute): boolean {
  return 'routeNotRetained' in route;
}

function validOverlayForMap(
  overlay: MapSessionOverlay | undefined,
  mapId: string,
): MapSessionOverlay | undefined {
  const parsed = MapSessionOverlaySchema.safeParse(overlay);
  if (!parsed.success || parsed.data.mapId !== mapId) return undefined;
  if (
    parsed.data.expiresAt &&
    (!Number.isFinite(Date.parse(parsed.data.expiresAt)) ||
      Date.parse(parsed.data.expiresAt) <= Date.now())
  ) {
    return undefined;
  }
  return parsed.data;
}

function appendPopupText(
  parent: HTMLElement,
  tagName: 'strong' | 'span',
  text: string,
  className?: string,
): void {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
}

function appendPopupLink(
  parent: HTMLElement,
  label: string,
  url: string,
): void {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className =
    'yaawc-map-popup-link rounded-control px-1 focus-border-neutral';
  link.textContent = label;
  parent.appendChild(link);
}

function createPlacePopup(place: MapPlace, number: number): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'yaawc-map-popup';
  appendPopupText(popup, 'strong', `${number}. ${place.name}`, 'block');

  if (place.address) {
    appendPopupText(popup, 'span', place.address, 'mt-1 block');
  }
  if (place.category) {
    appendPopupText(popup, 'span', place.category, 'mt-1 block text-fg-muted');
  }
  if (place.openingHours) {
    appendPopupText(
      popup,
      'span',
      `Hours: ${place.openingHours}`,
      'mt-1 block text-fg-muted',
    );
  }
  if (place.rating !== undefined) {
    const reviewCount =
      place.reviewCount === undefined ? '' : ` (${place.reviewCount} reviews)`;
    appendPopupText(
      popup,
      'span',
      `Rating: ${place.rating.toFixed(1)}${reviewCount}`,
      'mt-1 block text-fg-muted',
    );
  }

  const links = document.createElement('div');
  links.className = 'mt-2 flex flex-wrap gap-2';
  appendPopupLink(links, 'Open source', place.sourceUrl);
  if (place.websiteUrl) appendPopupLink(links, 'Website', place.websiteUrl);
  popup.appendChild(links);
  return popup;
}

function createCurrentLocationPopup(persisted: boolean): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'yaawc-map-popup';
  appendPopupText(popup, 'strong', 'Current location', 'block');
  appendPopupText(
    popup,
    'span',
    persisted
      ? 'Saved in this answer only.'
      : 'Visible only in this page session.',
    'mt-1 block text-fg-muted',
  );
  return popup;
}

function createRouteDestinationPopup(): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'yaawc-map-popup';
  appendPopupText(popup, 'strong', 'Route destination', 'block');
  return popup;
}

function mapStatusMessage(
  config: MappingClientConfig | null | undefined,
  configLoading: boolean,
  configError: boolean,
  configInvalid: boolean,
  mapStatus: MapRenderStatus,
  hasGeometry: boolean,
): string | undefined {
  if (configLoading) return 'Loading the current map configuration…';
  if (configError || configInvalid) {
    return 'The current map configuration is unavailable. Validated map details remain available.';
  }
  if (!config) {
    return 'The current map configuration is unavailable. Validated map details remain available.';
  }
  if (!config.enabled || config.unavailableReason === 'disabled') {
    return 'Interactive maps are disabled. Validated map details remain available.';
  }
  if (config.unavailableReason === 'public_acknowledgement_required') {
    return 'Map services require acknowledgement before they can be used. Validated map details remain available.';
  }
  if (config.unavailableReason === 'invalid_configuration') {
    return 'The map configuration is invalid. Validated map details remain available.';
  }
  if (config.unavailableReason === 'provider_unavailable') {
    return 'The map provider is unavailable. Validated map details remain available.';
  }
  if (!config.capabilities.tiles) {
    return 'Map tiles are unavailable. Validated map details remain available.';
  }
  if (!hasGeometry) return 'No interactive map geometry is available.';
  if (mapStatus === 'loading') return 'Loading the interactive map…';
  if (mapStatus === 'error') {
    return 'The interactive map could not be loaded. Validated map details remain available.';
  }
  if (mapStatus === 'tile-error') {
    return 'Map tiles could not be loaded. Validated map details remain available.';
  }
  return undefined;
}

function MapStatus({
  message,
  status,
}: {
  message: string | undefined;
  status: MapRenderStatus;
}) {
  if (!message) return null;
  const isFailure =
    status === 'error' || status === 'tile-error' || status === 'ready';
  return (
    <p
      data-map-status
      data-map-status-kind={status}
      role="status"
      aria-live="polite"
      className={
        isFailure
          ? 'mt-3 rounded-control border border-warning bg-warning-soft px-3 py-2 text-xs text-warning'
          : 'mt-3 rounded-control border border-surface-2 bg-well px-3 py-2 text-xs text-fg-muted'
      }
    >
      {message}
    </p>
  );
}

function MapWidgetLayout({
  spec,
  title,
  displayRoute,
  tileAttribution,
  status,
  statusMessage,
  showCanvas,
  canvasRef,
}: {
  spec: PersistableMapSpec;
  title: string;
  displayRoute: DisplayRoute | undefined;
  tileAttribution?: string;
  status: MapRenderStatus;
  statusMessage?: string;
  showCanvas: boolean;
  canvasRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const fullRoute =
    displayRoute && isFullRoute(displayRoute) ? displayRoute : undefined;
  const links = mapSpecLinks(spec, fullRoute);
  const routeWasRedacted = displayRoute ? isRedactedRoute(displayRoute) : false;

  return (
    <Card
      data-map-widget
      data-map-render-state={status}
      className="overflow-hidden"
    >
      <div className="px-4 pt-3">
        {title !== 'Map' && <h3 className="font-medium text-fg">{title}</h3>}
        {spec.summary && (
          <p className="mt-1 whitespace-pre-line text-fg-muted">
            {spec.summary}
          </p>
        )}

        {spec.places.length > 0 ? (
          <ol
            aria-label="Mapped places"
            className="mt-3 list-inside list-decimal space-y-1 text-fg"
          >
            {spec.places.map((place) => (
              <li key={place.id} className="pl-1">
                <span className="font-medium">{place.name}</span>
                {place.address && (
                  <span className="text-fg-muted"> — {place.address}</span>
                )}
                {place.category && (
                  <span className="text-fg-subtle"> ({place.category})</span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-fg-muted">
            No validated places are included.
          </p>
        )}

        {spec.origin && (
          <p className="mt-3 text-fg-muted">
            Current location is shown on the map and saved in this answer only.
          </p>
        )}

        {displayRoute && (
          <div
            data-map-route-summary
            className="mt-3 border-t border-surface-2 pt-3"
            role="group"
            aria-label="Route summary"
          >
            <p className="font-medium text-fg">Route summary</p>
            <p className="mt-1 text-fg-muted">
              {formatMapRouteSummary(displayRoute)}
            </p>
            {routeWasRedacted && (
              <p className="mt-1 text-fg-subtle">
                Route not retained in this answer.
              </p>
            )}
          </div>
        )}
        {!displayRoute && spec.routeNotRetained && (
          <div
            data-map-route-summary
            className="mt-3 border-t border-surface-2 pt-3"
            role="group"
            aria-label="Route summary"
          >
            <p className="font-medium text-fg">Route summary</p>
            <p className="mt-1 text-fg-subtle">
              Route not retained in this answer.
            </p>
          </div>
        )}

        <p className="mt-3 text-xs text-fg-subtle">
          Retrieved: <time dateTime={spec.retrievedAt}>{spec.retrievedAt}</time>
        </p>
      </div>

      <div className="px-4 pb-3">
        <MapStatus message={statusMessage} status={status} />
        {showCanvas && (
          <div
            ref={canvasRef}
            data-map-canvas
            role="region"
            aria-label="Interactive map"
            aria-busy={status === 'loading'}
            className="yaawc-map-canvas mt-3 min-h-64 w-full overflow-hidden rounded-control border border-surface-2 sm:h-80"
          />
        )}

        {links.length > 0 && (
          <div className="mt-3" data-map-links>
            <p className="text-xs font-medium text-fg-muted">Map links</p>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {links.map((link) => (
                <li key={`${link.label}:${link.url}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-control px-1 py-0.5 text-accent underline underline-offset-2 focus-border-neutral"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 border-t border-surface-2 pt-2 text-xs text-fg-subtle">
          <p>Map attribution: {spec.attribution}</p>
          {tileAttribution && (
            <p className="mt-1">Tile attribution: {tileAttribution}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function InvalidMapWidget({ title }: { title: string }) {
  return (
    <Card
      data-map-widget
      data-map-render-state="error"
      className="overflow-hidden"
    >
      <div className="px-4 py-3">
        {title !== 'Map' && <h3 className="font-medium text-fg">{title}</h3>}
        <p
          data-map-status
          data-map-status-kind="error"
          role="status"
          aria-live="polite"
          className="mt-3 rounded-control border border-warning bg-warning-soft px-3 py-2 text-xs text-warning"
        >
          Map data is unavailable. Validated map details remain available in the
          answer.
        </p>
      </div>
    </Card>
  );
}

function InteractiveMapWidget({
  spec,
  title,
  overlay,
}: {
  spec: PersistableMapSpec;
  title: string;
  overlay?: MapSessionOverlay;
}) {
  const { data, isPending, isError } = useMappingConfig();
  const configResult = useMemo(
    () =>
      data === undefined
        ? undefined
        : MappingClientConfigSchema.safeParse(data),
    [data],
  );
  const config = isError
    ? null
    : configResult?.success
      ? configResult.data
      : configResult === undefined
        ? undefined
        : null;
  const mapId = overlay?.mapId;
  const validOverlay = useMemo(
    () => validOverlayForMap(overlay, mapId ?? ''),
    [mapId, overlay],
  );
  const displayRoute = validOverlay?.route ?? spec.route;
  const renderData = useMemo<MapRenderData>(() => {
    const bounds: Array<[number, number]> = spec.places.map((place) => [
      place.coordinate.lat,
      place.coordinate.lon,
    ]);
    if (spec.origin) bounds.push([spec.origin.lat, spec.origin.lon]);
    const routeDestination = displayRoute?.destination;
    if (routeDestination) {
      bounds.push([routeDestination.lat, routeDestination.lon]);
    }

    const origin =
      validOverlay?.origin ?? validOverlay?.route?.origin ?? spec.origin;
    if (origin && !spec.origin) bounds.push([origin.lat, origin.lon]);

    const route = isFullRoute(displayRoute) ? displayRoute : undefined;
    if (route) {
      for (const [lon, lat] of route.geometry.coordinates) {
        bounds.push([lat, lon]);
      }
    }

    return {
      bounds,
      ...(route ? { route } : {}),
      ...(routeDestination ? { routeDestination } : {}),
      ...(origin ? { origin } : {}),
      originIsPersisted:
        validOverlay === undefined && spec.origin !== undefined,
    };
  }, [displayRoute, spec.origin, spec.places, validOverlay]);
  const hasGeometry = renderData.bounds.length > 0;
  const canInitialize = Boolean(
    config?.available && config.capabilities.tiles && hasGeometry,
  );
  const [mapStatus, setMapStatus] = useState<MapRenderStatus>('idle');
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!canInitialize || !config || !mapContainerRef.current) return;

    let disposed = false;
    setMapStatus('loading');
    const container = mapContainerRef.current;

    const initialize = async () => {
      try {
        const leafletModule = (await import('leaflet')) as unknown as {
          default?: typeof import('leaflet');
        } & typeof import('leaflet');
        const leaflet = leafletModule.default ?? leafletModule;
        if (disposed) return;

        const map = leaflet.map(container, {
          attributionControl: true,
          keyboard: true,
          scrollWheelZoom: false,
          zoomControl: true,
        });
        mapRef.current = map;
        map.attributionControl.addAttribution(spec.attribution);

        const tileLayer = leaflet.tileLayer(config.tile.url, {
          attribution: config.tile.attribution,
          maxZoom: 19,
        });
        const onTileError = () => {
          if (!disposed) setMapStatus('tile-error');
        };
        tileLayer.on('tileerror', onTileError);
        tileLayer.addTo(map);

        const numberedIcon = (number: number) =>
          leaflet.divIcon({
            className: 'yaawc-map-numbered-marker',
            html: String(number),
            iconAnchor: [16, 16],
            iconSize: [32, 32],
            popupAnchor: [0, -16],
          });

        spec.places.forEach((place, index) => {
          const marker = leaflet.marker(
            [place.coordinate.lat, place.coordinate.lon],
            {
              alt: `${index + 1}. ${place.name}`,
              icon: numberedIcon(index + 1),
              keyboard: true,
              title: `${index + 1}. ${place.name}`,
            },
          );
          marker.bindPopup(createPlacePopup(place, index + 1));
          const labelMarker = () => {
            const element = marker.getElement();
            if (!element) return;
            element.setAttribute('aria-label', `${index + 1}. ${place.name}`);
            element.setAttribute('role', 'button');
          };
          marker.on('add', labelMarker);
          marker.addTo(map);
          labelMarker();
        });

        if (renderData.route) {
          leaflet
            .polyline(
              renderData.route.geometry.coordinates.map(
                ([lon, lat]) => [lat, lon] as [number, number],
              ),
              {
                className: 'yaawc-map-route',
                color: 'var(--color-accent)',
                lineCap: 'round',
                lineJoin: 'round',
                opacity: 0.85,
                weight: 4,
              },
            )
            .addTo(map);
        } else if (renderData.routeDestination) {
          leaflet
            .circleMarker(
              [
                renderData.routeDestination.lat,
                renderData.routeDestination.lon,
              ],
              {
                className: 'yaawc-map-route-endpoint',
                color: 'var(--color-accent)',
                fillColor: 'var(--color-accent)',
                fillOpacity: 0.9,
                radius: 7,
                weight: 2,
              },
            )
            .bindPopup(createRouteDestinationPopup())
            .addTo(map);
        }

        if (renderData.origin) {
          leaflet
            .circleMarker([renderData.origin.lat, renderData.origin.lon], {
              className: 'yaawc-map-current-location',
              color: 'var(--color-accent)',
              fillColor: 'var(--color-accent)',
              fillOpacity: 0.25,
              radius: 9,
              weight: 2,
            })
            .bindPopup(
              createCurrentLocationPopup(renderData.originIsPersisted === true),
            )
            .addTo(map);
        }

        const bounds = leaflet.latLngBounds(renderData.bounds);
        if (renderData.bounds.length === 1) {
          map.setView(bounds.getCenter(), 14);
        } else {
          map.fitBounds(bounds, {
            maxZoom: 16,
            padding: [24, 24],
          });
        }
        map.invalidateSize();
        if (!disposed) setMapStatus('ready');
      } catch {
        const map = mapRef.current;
        mapRef.current = null;
        if (map) {
          try {
            map.remove();
          } catch {
            // Ignore a partial Leaflet teardown; the semantic fallback remains.
          }
        }
        if (!disposed) setMapStatus('error');
      }
    };

    void initialize();

    return () => {
      disposed = true;
      const map = mapRef.current;
      mapRef.current = null;
      if (map) {
        try {
          map.remove();
        } catch {
          // Leaflet may already have removed the map during a failed teardown.
        }
      }
    };
  }, [canInitialize, config, renderData, spec.attribution, spec.places]);

  const statusMessage = mapStatusMessage(
    config,
    isPending && data === undefined,
    isError,
    configResult !== undefined && !configResult.success,
    mapStatus,
    hasGeometry,
  );
  const showCanvas = canInitialize;

  return (
    <MapWidgetLayout
      spec={spec}
      title={title}
      displayRoute={displayRoute}
      tileAttribution={config?.tile.attribution}
      status={mapStatus}
      statusMessage={statusMessage}
      showCanvas={showCanvas}
      canvasRef={mapContainerRef}
    />
  );
}

/**
 * Render validated map details immediately, then initialize Leaflet only after
 * hydration. This keeps server-rendered and no-JavaScript output useful and
 * avoids importing Leaflet in the server bundle.
 */
const subscribeToNothing = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function MapWidget({
  spec,
  title: requestedTitle,
  overlay,
}: MapWidgetProps) {
  const clientReady = useSyncExternalStore(
    subscribeToNothing,
    getClientSnapshot,
    getServerSnapshot,
  );
  const parsedSpec = useMemo(
    () => PersistableMapSpecSchema.safeParse(spec),
    [spec],
  );
  const title =
    requestedTitle?.trim() ||
    (parsedSpec.success ? parsedSpec.data.title?.trim() : '') ||
    'Map';

  if (!parsedSpec.success) return <InvalidMapWidget title={title} />;
  if (!clientReady) {
    return (
      <MapWidgetLayout
        spec={parsedSpec.data}
        title={title}
        displayRoute={parsedSpec.data.route}
        status="idle"
        showCanvas={false}
      />
    );
  }

  return (
    <InteractiveMapWidget
      spec={parsedSpec.data}
      title={title}
      overlay={overlay}
    />
  );
}

export { MapWidget };
