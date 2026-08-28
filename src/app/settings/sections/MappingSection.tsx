'use client';

import { Database, Map as MapIcon, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import SettingsSection from '../components/SettingsSection';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import SettingToggleRow from '@/components/ui/SettingToggleRow';
import { Button } from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import {
  PUBLIC_MAP_DEFAULTS,
  normalizeMappingAttribution,
  normalizeMappingEndpoint,
  normalizeMappingTileUrl,
  publicMapServiceHosts,
  mappingServiceHosts,
} from '@/lib/maps/config';
import { useClearMapCache, useMappingConfig } from '@/lib/hooks/api/useMapping';
import { qk } from '@/lib/api/keys';
import { flushSettings } from '@/lib/settings/persist';
import {
  useLocalStorageBoolean,
  useLocalStorageString,
} from '@/lib/hooks/useLocalStorage';

const ROUTING_PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

function profileError(
  value: string,
  label: string,
  required = false,
): string | undefined {
  const normalized = value.trim();
  if (!normalized) return required ? `${label} is required` : undefined;
  return ROUTING_PROFILE_PATTERN.test(normalized)
    ? undefined
    : `${label} must use letters, numbers, hyphens, or underscores (up to 32 characters)`;
}

function sameEndpointHost(value: string, fallback: string): boolean {
  try {
    return (
      new URL(value).hostname.toLowerCase() ===
      new URL(fallback).hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

function CapabilityStatus({
  label,
  available,
}: {
  label: string;
  available: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 text-xs">
      <span>{label}</span>
      <span className={available ? 'text-success' : 'text-fg-subtle'}>
        {available ? 'Available' : 'Unavailable'}
      </span>
    </li>
  );
}

export default function MappingSection() {
  const queryClient = useQueryClient();
  const { data: mappingConfig, isError: mappingConfigError } =
    useMappingConfig();
  const clearCache = useClearMapCache();

  const [mappingEnabled, setMappingEnabled] = useLocalStorageBoolean(
    'mappingEnabled',
    false,
  );
  const [publicServicesAcknowledged, setPublicServicesAcknowledged] =
    useLocalStorageBoolean('mappingPublicServicesAcknowledged', false);
  const [geocoderUrl, setGeocoderUrl] = useLocalStorageString(
    'mappingGeocoderUrl',
    PUBLIC_MAP_DEFAULTS.geocoderUrl,
  );
  const [placesUrl, setPlacesUrl] = useLocalStorageString(
    'mappingPlacesUrl',
    PUBLIC_MAP_DEFAULTS.placesUrl,
  );
  const [routingUrl, setRoutingUrl] = useLocalStorageString(
    'mappingRoutingUrl',
    PUBLIC_MAP_DEFAULTS.routingUrl,
  );
  const [routingProfile, setRoutingProfile] = useLocalStorageString(
    'mappingRoutingProfile',
    PUBLIC_MAP_DEFAULTS.routingProfile,
  );
  const [walkingProfile, setWalkingProfile] = useLocalStorageString(
    'mappingWalkingProfile',
    '',
  );
  const [cyclingProfile, setCyclingProfile] = useLocalStorageString(
    'mappingCyclingProfile',
    '',
  );
  const [tileUrl, setTileUrl] = useLocalStorageString(
    'mappingTileUrl',
    PUBLIC_MAP_DEFAULTS.tileUrl,
  );
  const [tileAttribution, setTileAttribution] = useLocalStorageString(
    'mappingTileAttribution',
    PUBLIC_MAP_DEFAULTS.tileAttribution,
  );
  const [savedLocationEnabled, setSavedLocationEnabled] =
    useLocalStorageBoolean('mappingSavedLocationEnabled', false);

  const [acknowledgementOpen, setAcknowledgementOpen] = useState(false);
  const [enableAfterAcknowledgement, setEnableAfterAcknowledgement] =
    useState(false);
  const [cacheNotice, setCacheNotice] = useState<
    { tone: 'success' | 'danger'; message: string } | undefined
  >();

  const refreshMappingConfiguration = useCallback(async () => {
    await flushSettings();
    await queryClient.invalidateQueries({ queryKey: qk.mappingConfig });
  }, [queryClient]);

  const validation = useMemo(
    () => ({
      geocoder: normalizeMappingEndpoint(geocoderUrl, 'Geocoder URL').error,
      places: normalizeMappingEndpoint(placesUrl, 'Places URL').error,
      routing: normalizeMappingEndpoint(routingUrl, 'Routing URL').error,
      driving: profileError(routingProfile, 'Driving profile', true),
      walking: profileError(walkingProfile, 'Walking profile'),
      cycling: profileError(cyclingProfile, 'Cycling profile'),
      tile: normalizeMappingTileUrl(tileUrl).error,
      attribution: normalizeMappingAttribution(tileAttribution).error,
    }),
    [
      geocoderUrl,
      placesUrl,
      routingUrl,
      routingProfile,
      walkingProfile,
      cyclingProfile,
      tileUrl,
      tileAttribution,
    ],
  );

  const hasValidationErrors = Object.values(validation).some(Boolean);
  const endpoints = useMemo(
    () => ({
      geocoderUrl,
      placesUrl,
      routingUrl,
      tileUrl,
    }),
    [geocoderUrl, placesUrl, routingUrl, tileUrl],
  );
  const serviceHosts = useMemo(
    () => mappingServiceHosts({ endpoints }),
    [endpoints],
  );
  const publicHosts = useMemo(
    () => publicMapServiceHosts({ endpoints }),
    [endpoints],
  );
  const usesPublicServices =
    sameEndpointHost(geocoderUrl, PUBLIC_MAP_DEFAULTS.geocoderUrl) ||
    sameEndpointHost(placesUrl, PUBLIC_MAP_DEFAULTS.placesUrl) ||
    sameEndpointHost(routingUrl, PUBLIC_MAP_DEFAULTS.routingUrl) ||
    sameEndpointHost(tileUrl, PUBLIC_MAP_DEFAULTS.tileUrl);
  const disclosedPublicHosts = useMemo(
    () =>
      Array.from(
        new Set([...publicHosts, ...(mappingConfig?.publicServiceHosts ?? [])]),
      ),
    [mappingConfig?.publicServiceHosts, publicHosts],
  );

  const capabilities = {
    geocoding: !validation.geocoder,
    nearby: !validation.places,
    placeDetails: !validation.places,
    routing: !validation.routing && !validation.driving,
    routeModes: [
      ...(!validation.routing && !validation.driving ? ['driving'] : []),
      ...(walkingProfile.trim() && !validation.routing && !validation.walking
        ? ['walking']
        : []),
      ...(cyclingProfile.trim() && !validation.routing && !validation.cycling
        ? ['cycling']
        : []),
    ],
    tiles: !validation.tile && !validation.attribution,
  };

  const serverBlocksMapping =
    mappingConfigError ||
    (mappingConfig?.enabled &&
      (mappingConfig.unavailableReason === 'invalid_configuration' ||
        mappingConfig.unavailableReason === 'provider_unavailable'));
  const mappingReady =
    mappingEnabled &&
    !hasValidationErrors &&
    (!usesPublicServices || publicServicesAcknowledged) &&
    !serverBlocksMapping;

  const openAcknowledgement = (enableAfter = false) => {
    setEnableAfterAcknowledgement(enableAfter);
    setAcknowledgementOpen(true);
  };

  const handleMappingEnabled = (checked: boolean) => {
    if (checked && usesPublicServices && !publicServicesAcknowledged) {
      openAcknowledgement(true);
      return;
    }
    setMappingEnabled(checked);
    void refreshMappingConfiguration();
  };

  const handlePublicAcknowledgement = (checked: boolean) => {
    if (checked) {
      openAcknowledgement(false);
      return;
    }
    setPublicServicesAcknowledged(false);
    void refreshMappingConfiguration();
  };

  const confirmAcknowledgement = () => {
    setPublicServicesAcknowledged(true);
    if (enableAfterAcknowledgement) setMappingEnabled(true);
    setAcknowledgementOpen(false);
    setEnableAfterAcknowledgement(false);
    void refreshMappingConfiguration();
  };

  const closeAcknowledgement = () => {
    setAcknowledgementOpen(false);
    setEnableAfterAcknowledgement(false);
  };

  const normalizeAndRefresh = (
    value: string,
    setter: (next: string) => void,
    normalize: () => { value: string; error?: string },
  ) => {
    const result = normalize();
    if (!result.error && result.value !== value) setter(result.value);
    void refreshMappingConfiguration();
  };

  const normalizeProfileAndRefresh = (
    value: string,
    setter: (next: string) => void,
  ) => {
    const normalized = value.trim();
    if (normalized !== value) setter(normalized);
    void refreshMappingConfiguration();
  };

  const handleClearCache = () => {
    setCacheNotice(undefined);
    clearCache.mutate(undefined, {
      onSuccess: ({ deleted }) => {
        setCacheNotice({
          tone: 'success',
          message:
            deleted === 0
              ? 'No cached map data was present.'
              : `Cleared ${deleted} cached map entr${deleted === 1 ? 'y' : 'ies'}.`,
        });
      },
      onError: () => {
        setCacheNotice({
          tone: 'danger',
          message: 'Could not clear the map cache. Try again.',
        });
      },
    });
  };

  const statusMessage = !mappingEnabled
    ? 'Mapping is disabled. No mapping provider or tile requests are made.'
    : hasValidationErrors
      ? 'Mapping is unavailable until the highlighted settings are fixed.'
      : usesPublicServices && !publicServicesAcknowledged
        ? 'Acknowledge the listed public services before mapping can contact them.'
        : mappingConfigError
          ? 'Mapping availability could not be checked. Existing chat and search remain available.'
          : mappingConfig?.unavailableReason === 'provider_unavailable'
            ? 'The configured mapping provider is unavailable. Check the provider or endpoint settings.'
            : mappingConfig?.unavailableReason === 'invalid_configuration'
              ? 'The server rejected the mapping configuration. Check the highlighted values and try again.'
              : 'Mapping is enabled for eligible Web Search turns.';

  return (
    <>
      <div id="mapping">
        <SettingsSection title="Mapping">
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs text-fg-muted">
                Mapping is disabled by default. It uses the
                OpenStreetMap-compatible geocoder, places, routing, and tile
                endpoints below only after you enable it. Replace every endpoint
                with your own service to run a self-hosted setup.
              </p>
              <p
                className={
                  mappingReady ? 'text-xs text-success' : 'text-xs text-warning'
                }
                role="status"
              >
                {statusMessage}
              </p>
            </div>

            <div className="space-y-3">
              <SettingToggleRow
                icon={MapIcon}
                className="rounded-surface bg-surface p-3"
                label="Enable mapping"
                description={
                  usesPublicServices
                    ? 'Allows eligible Web Search turns to use the configured mapping services after acknowledgement.'
                    : 'Allows eligible Web Search turns to use the configured endpoints.'
                }
                checked={mappingEnabled}
                onChange={handleMappingEnabled}
                ariaLabel="Enable mapping"
              />

              <SettingToggleRow
                nested
                label="Acknowledge public mapping services"
                description={
                  usesPublicServices
                    ? 'Required before the shipped public OpenStreetMap services can be contacted. Requests are low-volume and identify YAAWC.'
                    : 'Not required while all configured services are self-hosted.'
                }
                checked={publicServicesAcknowledged}
                onChange={handlePublicAcknowledgement}
                disabled={!usesPublicServices}
                ariaLabel="Acknowledge public mapping services"
              />
            </div>

            <div className="space-y-4">
              <p className="text-sm font-medium">Provider endpoints</p>
              <Field label="Geocoder URL" error={validation.geocoder}>
                <Input
                  value={geocoderUrl}
                  onChange={(event) => setGeocoderUrl(event.target.value)}
                  onBlur={() =>
                    normalizeAndRefresh(geocoderUrl, setGeocoderUrl, () =>
                      normalizeMappingEndpoint(geocoderUrl, 'Geocoder URL'),
                    )
                  }
                  placeholder={PUBLIC_MAP_DEFAULTS.geocoderUrl}
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>

              <Field label="Places URL" error={validation.places}>
                <Input
                  value={placesUrl}
                  onChange={(event) => setPlacesUrl(event.target.value)}
                  onBlur={() =>
                    normalizeAndRefresh(placesUrl, setPlacesUrl, () =>
                      normalizeMappingEndpoint(placesUrl, 'Places URL'),
                    )
                  }
                  placeholder={PUBLIC_MAP_DEFAULTS.placesUrl}
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>

              <Field label="Routing URL" error={validation.routing}>
                <Input
                  value={routingUrl}
                  onChange={(event) => setRoutingUrl(event.target.value)}
                  onBlur={() =>
                    normalizeAndRefresh(routingUrl, setRoutingUrl, () =>
                      normalizeMappingEndpoint(routingUrl, 'Routing URL'),
                    )
                  }
                  placeholder={PUBLIC_MAP_DEFAULTS.routingUrl}
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="space-y-4">
              <p className="text-sm font-medium">Routing profiles</p>
              <Field label="Driving profile" error={validation.driving}>
                <Input
                  value={routingProfile}
                  onChange={(event) => setRoutingProfile(event.target.value)}
                  onBlur={() =>
                    normalizeProfileAndRefresh(
                      routingProfile,
                      setRoutingProfile,
                    )
                  }
                  placeholder={PUBLIC_MAP_DEFAULTS.routingProfile}
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>

              <Field
                label="Walking profile (optional)"
                hint="Leave blank when the routing service does not provide walking routes."
                error={validation.walking}
              >
                <Input
                  value={walkingProfile}
                  onChange={(event) => setWalkingProfile(event.target.value)}
                  onBlur={() =>
                    normalizeProfileAndRefresh(
                      walkingProfile,
                      setWalkingProfile,
                    )
                  }
                  placeholder="foot"
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>

              <Field
                label="Cycling profile (optional)"
                hint="Leave blank when the routing service does not provide cycling routes."
                error={validation.cycling}
              >
                <Input
                  value={cyclingProfile}
                  onChange={(event) => setCyclingProfile(event.target.value)}
                  onBlur={() =>
                    normalizeProfileAndRefresh(
                      cyclingProfile,
                      setCyclingProfile,
                    )
                  }
                  placeholder="bike"
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="space-y-4">
              <p className="text-sm font-medium">Map tiles</p>
              <Field
                label="Tile URL template"
                hint="Must include {z}, {x}, and {y} placeholders."
                error={validation.tile}
              >
                <Input
                  value={tileUrl}
                  onChange={(event) => setTileUrl(event.target.value)}
                  onBlur={() =>
                    normalizeAndRefresh(tileUrl, setTileUrl, () =>
                      normalizeMappingTileUrl(tileUrl),
                    )
                  }
                  placeholder={PUBLIC_MAP_DEFAULTS.tileUrl}
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>

              <Field label="Tile attribution" error={validation.attribution}>
                <Input
                  value={tileAttribution}
                  onChange={(event) => setTileAttribution(event.target.value)}
                  onBlur={() =>
                    normalizeAndRefresh(
                      tileAttribution,
                      setTileAttribution,
                      () => normalizeMappingAttribution(tileAttribution),
                    )
                  }
                  placeholder={PUBLIC_MAP_DEFAULTS.tileAttribution}
                />
              </Field>
            </div>

            <div className="rounded-surface border border-surface-2 bg-surface-2/30 p-3">
              <p className="mb-2 text-sm font-medium">
                Configured capabilities
              </p>
              <ul className="space-y-1.5">
                <CapabilityStatus
                  label="Geocoding"
                  available={capabilities.geocoding}
                />
                <CapabilityStatus
                  label="Nearby places"
                  available={capabilities.nearby}
                />
                <CapabilityStatus
                  label="Place details"
                  available={capabilities.placeDetails}
                />
                <CapabilityStatus
                  label="Driving routes"
                  available={capabilities.routeModes.includes('driving')}
                />
                <CapabilityStatus
                  label="Walking routes"
                  available={capabilities.routeModes.includes('walking')}
                />
                <CapabilityStatus
                  label="Cycling routes"
                  available={capabilities.routeModes.includes('cycling')}
                />
                <CapabilityStatus
                  label="Map tiles"
                  available={capabilities.tiles}
                />
              </ul>
            </div>

            <div className="space-y-3 border-t border-surface-2 pt-4">
              <p className="text-sm font-medium">
                Saved personalization location
              </p>
              <p className="text-xs text-fg-muted">
                This is separate from the general personalization controls. When
                enabled, a saved location may be sent to mapping providers for
                eligible non-private Web Search turns. Private chats never send
                it, and this setting never enables general profile sharing.
              </p>
              <p className="text-xs text-fg-muted">
                Hosts that may receive mapping requests:{' '}
                <span className="font-mono">
                  {serviceHosts.length > 0
                    ? serviceHosts.join(', ')
                    : 'none configured'}
                </span>
              </p>
              <SettingToggleRow
                icon={MapIcon}
                className="rounded-surface bg-surface p-3"
                label="Allow saved location for mapping"
                description={
                  mappingReady
                    ? 'Provider use is limited to the current mapping operation and its disclosed hosts.'
                    : 'Enable and configure mapping before allowing saved-location use.'
                }
                checked={savedLocationEnabled}
                onChange={(checked) => {
                  setSavedLocationEnabled(checked);
                  void refreshMappingConfiguration();
                }}
                disabled={!mappingReady}
                ariaLabel="Allow saved location for mapping"
              />
            </div>

            <div className="space-y-3 border-t border-surface-2 pt-4">
              <div className="flex items-center gap-2">
                <Database size={16} className="text-accent" />
                <p className="text-sm font-medium">Map cache</p>
              </div>
              <p className="text-xs text-fg-muted">
                The durable cache contains only coarse localities and public
                business records. Exact addresses, routes, browser coordinates,
                and nearby coordinate requests stay in bounded memory only.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="dangerSoft"
                  size="sm"
                  icon={Trash2}
                  loading={clearCache.isPending}
                  onClick={handleClearCache}
                >
                  Clear map cache
                </Button>
                {cacheNotice && (
                  <p
                    role={cacheNotice.tone === 'danger' ? 'alert' : 'status'}
                    className={
                      cacheNotice.tone === 'danger'
                        ? 'text-xs text-danger'
                        : 'text-xs text-success'
                    }
                  >
                    {cacheNotice.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </SettingsSection>
      </div>

      <Modal
        open={acknowledgementOpen}
        onClose={closeAcknowledgement}
        size="md"
        title="Acknowledge public mapping services"
        footer={
          <>
            <Button variant="ghost" onClick={closeAcknowledgement}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmAcknowledgement}>
              Acknowledge and continue
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <p className="text-fg-muted">
            The configured public OpenStreetMap-compatible services are operated
            by third parties. YAAWC will make low-volume requests only for
            eligible Web Search turns, identify itself, observe provider limits,
            and show the required attribution. Review the hosts before
            continuing.
          </p>
          <div>
            <p className="mb-2 font-medium">
              Hosts that may receive mapping requests
            </p>
            {disclosedPublicHosts.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-fg-muted">
                {disclosedPublicHosts.map((host) => (
                  <li key={host} className="font-mono">
                    {host}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-muted">
                No public hosts are currently detected. Self-hosted endpoints
                still require explicit mapping enablement.
              </p>
            )}
          </div>
          <p className="text-xs text-fg-muted">
            You can disable mapping or replace these endpoints at any time.
            Existing answer snapshots do not refresh provider data when
            reopened.
          </p>
        </div>
      </Modal>
    </>
  );
}
