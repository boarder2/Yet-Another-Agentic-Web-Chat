/**
 * Pure helpers for reading YouTube caption metadata and JSON3 transcripts.
 *
 * YouTube's player response is untyped JSON and its caption list contains a
 * mixture of metadata and signed URLs. Keep the validation and selection rules
 * here so retrieval code does not have to trust either response shape.
 */

export interface YouTubeCaptionTrackName {
  simpleText?: string;
  runs?: Array<{ text?: string }>;
}

export interface YouTubeCaptionTrack {
  baseUrl: string;
  name?: YouTubeCaptionTrackName;
  vssId?: string;
  languageCode?: string;
  kind?: string;
  isTranslatable?: boolean;
  trackName?: string;
  variant?: string;
  isTranslated?: boolean;
  tlang?: string;
  isDefault?: boolean;
}

export interface YouTubeCaptionAudioTrack {
  captionTrackIndices?: number[];
  defaultCaptionTrackIndex?: number;
  hasDefaultTrack?: boolean;
  audioTrackId?: string;
}

export interface YouTubeCaptionTrackList {
  captionTracks: YouTubeCaptionTrack[];
  audioTracks: YouTubeCaptionAudioTrack[];
  defaultAudioTrackIndex?: number;
  defaultCaptionTrackIndex?: number;
}

/** The portions of a player response used by caption retrieval. */
export interface YouTubePlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: YouTubeCaptionTrackListRenderer;
  };
}

export interface YouTubeCaptionTrackListRenderer {
  captionTracks?: unknown[];
  audioTracks?: unknown[];
  defaultAudioTrackIndex?: unknown;
  defaultCaptionTrackIndex?: unknown;
}

export interface YouTubeJson3CaptionSegment {
  utf8?: unknown;
}

export interface YouTubeJson3CaptionEvent {
  tStartMs?: unknown;
  segs?: unknown;
}

export interface YouTubeJson3CaptionResponse {
  events?: unknown;
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function readTrackName(value: unknown): YouTubeCaptionTrackName | undefined {
  if (typeof value === 'string' && value.trim()) {
    return { simpleText: value };
  }

  const record = asRecord(value);
  if (!record) return undefined;

  const simpleText = optionalString(record.simpleText);
  const runs = Array.isArray(record.runs)
    ? record.runs
        .map((run) => {
          const text = optionalString(asRecord(run)?.text);
          return text ? { text } : null;
        })
        .filter((run): run is { text: string } => run !== null)
    : undefined;

  if (!simpleText && (!runs || runs.length === 0)) return undefined;
  return {
    ...(simpleText ? { simpleText } : {}),
    ...(runs && runs.length > 0 ? { runs } : {}),
  };
}

function readCaptionTrack(value: unknown): YouTubeCaptionTrack | null {
  const record = asRecord(value);
  const baseUrl = optionalString(record?.baseUrl);
  if (!baseUrl) return null;

  const name = readTrackName(record?.name);
  return {
    baseUrl,
    ...(name ? { name } : {}),
    ...(optionalString(record?.vssId)
      ? { vssId: optionalString(record?.vssId) }
      : {}),
    ...(optionalString(record?.languageCode)
      ? { languageCode: optionalString(record?.languageCode) }
      : {}),
    ...(optionalString(record?.kind)
      ? { kind: optionalString(record?.kind) }
      : {}),
    ...(typeof record?.isTranslatable === 'boolean'
      ? { isTranslatable: record.isTranslatable }
      : {}),
    ...(optionalString(record?.trackName)
      ? { trackName: optionalString(record?.trackName) }
      : {}),
    ...(optionalString(record?.variant)
      ? { variant: optionalString(record?.variant) }
      : {}),
    ...(typeof record?.isTranslated === 'boolean'
      ? { isTranslated: record.isTranslated }
      : {}),
    ...(optionalString(record?.tlang)
      ? { tlang: optionalString(record?.tlang) }
      : {}),
    ...(typeof record?.isDefault === 'boolean'
      ? { isDefault: record.isDefault }
      : {}),
  };
}

type IndexMap = Map<number, number>;

function remapIndex(index: number | undefined, sourceToIndex?: IndexMap) {
  if (index === undefined) return undefined;
  return sourceToIndex ? sourceToIndex.get(index) : index;
}

function readAudioTrack(
  value: unknown,
  captionSourceToIndex?: IndexMap,
): YouTubeCaptionAudioTrack | null {
  const record = asRecord(value);
  if (!record) return null;

  const captionTrackIndices = Array.isArray(record.captionTrackIndices)
    ? record.captionTrackIndices
        .map(nonNegativeInteger)
        .map((index) => remapIndex(index, captionSourceToIndex))
        .filter((index): index is number => index !== undefined)
    : undefined;
  const defaultCaptionTrackIndex = remapIndex(
    nonNegativeInteger(record.defaultCaptionTrackIndex),
    captionSourceToIndex,
  );
  const hasDefaultTrack =
    typeof record.hasDefaultTrack === 'boolean'
      ? record.hasDefaultTrack
      : undefined;
  const audioTrackId = optionalString(record.audioTrackId);

  if (
    !captionTrackIndices &&
    defaultCaptionTrackIndex === undefined &&
    hasDefaultTrack === undefined &&
    !audioTrackId
  ) {
    return null;
  }

  return {
    ...(captionTrackIndices ? { captionTrackIndices } : {}),
    ...(defaultCaptionTrackIndex !== undefined
      ? { defaultCaptionTrackIndex }
      : {}),
    ...(hasDefaultTrack !== undefined ? { hasDefaultTrack } : {}),
    ...(audioTrackId ? { audioTrackId } : {}),
  };
}

function normalizeCaptionTracks(values: unknown[]) {
  const entries = values
    .map((value, sourceIndex) => ({
      sourceIndex,
      track: readCaptionTrack(value),
    }))
    .filter(
      (entry): entry is { sourceIndex: number; track: YouTubeCaptionTrack } =>
        entry.track !== null,
    );

  return {
    tracks: entries.map((entry) => entry.track),
    sourceToIndex: new Map(
      entries.map((entry, index) => [entry.sourceIndex, index]),
    ),
  };
}

function normalizeAudioTracks(
  values: unknown[],
  captionSourceToIndex: IndexMap,
) {
  const entries = values
    .map((value, sourceIndex) => ({
      sourceIndex,
      track: readAudioTrack(value, captionSourceToIndex),
    }))
    .filter(
      (
        entry,
      ): entry is {
        sourceIndex: number;
        track: YouTubeCaptionAudioTrack;
      } => entry.track !== null,
    );

  return {
    tracks: entries.map((entry) => entry.track),
    sourceToIndex: new Map(
      entries.map((entry, index) => [entry.sourceIndex, index]),
    ),
  };
}

function findTrackListRenderer(value: unknown): RecordValue | null {
  const root = asRecord(parseJsonValue(value));
  if (!root) return null;

  const directRenderer = asRecord(root.playerCaptionsTracklistRenderer);
  if (directRenderer) return directRenderer;

  const captions = asRecord(root.captions);
  const nestedRenderer = asRecord(captions?.playerCaptionsTracklistRenderer);
  if (nestedRenderer) return nestedRenderer;

  // Accept the renderer-shaped captions object as well as the full player
  // response. This keeps the reader useful with page-evaluated subtrees.
  if (Array.isArray(captions?.captionTracks)) return captions;
  if (Array.isArray(root.captionTracks)) return root;
  return null;
}

/**
 * Read and validate the caption list from a full player response or a
 * renderer-shaped subtree. `null` means the response did not advertise a
 * caption track list; an empty `captionTracks` array is a valid empty list.
 */
export function readCaptionTrackList(
  value: unknown,
): YouTubeCaptionTrackList | null {
  const renderer = findTrackListRenderer(value);
  if (!renderer || !Array.isArray(renderer.captionTracks)) return null;

  const captionNormalization = normalizeCaptionTracks(renderer.captionTracks);
  const audioNormalization = Array.isArray(renderer.audioTracks)
    ? normalizeAudioTracks(
        renderer.audioTracks,
        captionNormalization.sourceToIndex,
      )
    : { tracks: [], sourceToIndex: new Map<number, number>() };
  const defaultAudioTrackIndex = remapIndex(
    nonNegativeInteger(renderer.defaultAudioTrackIndex),
    audioNormalization.sourceToIndex,
  );
  const defaultCaptionTrackIndex = remapIndex(
    nonNegativeInteger(renderer.defaultCaptionTrackIndex),
    captionNormalization.sourceToIndex,
  );

  return {
    captionTracks: captionNormalization.tracks,
    audioTracks: audioNormalization.tracks,
    ...(defaultAudioTrackIndex !== undefined ? { defaultAudioTrackIndex } : {}),
    ...(defaultCaptionTrackIndex !== undefined
      ? { defaultCaptionTrackIndex }
      : {}),
  };
}

/** Return only validated caption tracks from a player response. */
export function getCaptionTracks(value: unknown): YouTubeCaptionTrack[] {
  return readCaptionTrackList(value)?.captionTracks ?? [];
}

function hasTranslatedUrl(track: YouTubeCaptionTrack): boolean {
  try {
    return new URL(track.baseUrl).searchParams.has('tlang');
  } catch {
    return /(?:^|[?&])tlang(?:=|&|$)/i.test(track.baseUrl);
  }
}

function isOriginalCaptionTrack(track: YouTubeCaptionTrack): boolean {
  return !(
    track.isTranslated === true ||
    Boolean(track.tlang?.trim()) ||
    track.kind?.toLowerCase() === 'translated' ||
    hasTranslatedUrl(track)
  );
}

function trackIndex(
  tracks: YouTubeCaptionTrack[],
  index: number | undefined,
): number | undefined {
  if (
    index === undefined ||
    index < 0 ||
    index >= tracks.length ||
    !isOriginalCaptionTrack(tracks[index])
  ) {
    return undefined;
  }
  return index;
}

function audioTrackOrder(
  list: YouTubeCaptionTrackList,
): YouTubeCaptionAudioTrack[] {
  const ordered: YouTubeCaptionAudioTrack[] = [];
  const seen = new Set<YouTubeCaptionAudioTrack>();

  const add = (track: YouTubeCaptionAudioTrack | undefined) => {
    if (!track || seen.has(track)) return;
    seen.add(track);
    ordered.push(track);
  };

  if (list.defaultAudioTrackIndex !== undefined) {
    add(list.audioTracks[list.defaultAudioTrackIndex]);
  }
  list.audioTracks
    .filter((track) => track.hasDefaultTrack === true)
    .forEach(add);
  list.audioTracks
    .filter((track) => track.defaultCaptionTrackIndex !== undefined)
    .forEach(add);
  return ordered;
}

function declaredDefaultTrack(
  list: YouTubeCaptionTrackList,
): YouTubeCaptionTrack | undefined {
  const direct = trackIndex(list.captionTracks, list.defaultCaptionTrackIndex);
  if (direct !== undefined) return list.captionTracks[direct];

  for (const audioTrack of audioTrackOrder(list)) {
    const directIndex = trackIndex(
      list.captionTracks,
      audioTrack.defaultCaptionTrackIndex,
    );
    if (directIndex !== undefined) return list.captionTracks[directIndex];

    if (audioTrack.defaultCaptionTrackIndex !== undefined) {
      const mappedIndex =
        audioTrack.captionTrackIndices?.[audioTrack.defaultCaptionTrackIndex];
      const mapped = trackIndex(list.captionTracks, mappedIndex);
      if (mapped !== undefined) return list.captionTracks[mapped];
    }

    if (audioTrack.hasDefaultTrack) {
      const first = trackIndex(
        list.captionTracks,
        audioTrack.captionTrackIndices?.[0],
      );
      if (first !== undefined) return list.captionTracks[first];
    }
  }

  return list.captionTracks.find(
    (track) => track.isDefault === true && isOriginalCaptionTrack(track),
  );
}

/**
 * Select YouTube's declared default original track, then English, then the
 * first original track. Translated tracks (including URLs with `tlang`) are
 * never selected.
 *
 * The first argument may be a full player response, a caption renderer, a
 * normalized track list, or an array of raw tracks. The optional second
 * argument supplies audio-track metadata when an array of tracks is passed.
 */
export function selectCaptionTrack(
  value: unknown,
  audioTrackValues?: unknown,
): YouTubeCaptionTrack | null {
  let list: YouTubeCaptionTrackList | null;

  if (Array.isArray(value)) {
    const captionNormalization = normalizeCaptionTracks(value);
    const audioNormalization = Array.isArray(audioTrackValues)
      ? normalizeAudioTracks(
          audioTrackValues,
          captionNormalization.sourceToIndex,
        )
      : { tracks: [], sourceToIndex: new Map<number, number>() };
    list = {
      captionTracks: captionNormalization.tracks,
      audioTracks: audioNormalization.tracks,
    };
  } else {
    list = readCaptionTrackList(value);
  }

  if (!list || list.captionTracks.length === 0) return null;

  const declared = declaredDefaultTrack(list);
  if (declared) return declared;

  const originalTracks = list.captionTracks.filter(isOriginalCaptionTrack);
  if (originalTracks.length === 0) return null;

  const english = originalTracks.find((track) => {
    const languageCode = track.languageCode?.toLowerCase();
    if (languageCode === 'en' || languageCode?.startsWith('en-')) return true;

    const name = [
      track.name?.simpleText,
      ...(track.name?.runs?.map((run) => run.text ?? '') ?? []),
    ]
      .join(' ')
      .trim();
    return /^english(?:\s|\(|$)/i.test(name);
  });

  return english ?? originalTracks[0];
}

/** Whether a caption track is one of YouTube's Gemini-generated tracks. */
export function isGeminiCaptionTrack(track: unknown): boolean {
  const record = asRecord(track);
  if (!record) return false;

  const variant = optionalString(record.variant);
  if (variant?.toLowerCase() === 'gemini') return true;

  const baseUrl = optionalString(record.baseUrl);
  if (!baseUrl) return false;
  try {
    return (
      new URL(baseUrl).searchParams.get('variant')?.toLowerCase() === 'gemini'
    );
  } catch {
    return /(?:^|[?&])variant=gemini(?:&|#|$)/i.test(baseUrl);
  }
}

/** What a player response says about captions, for failure diagnostics. */
export interface YouTubeCaptionAvailability {
  playabilityStatus?: string;
  playabilityReason?: string;
  advertisedTrackCount: number;
  usableTrackCount: number;
  tracks: string[];
}

function describeTrack(track: YouTubeCaptionTrack): string {
  const parts = [track.languageCode ?? '?', track.kind ?? 'standard'];
  if (isGeminiCaptionTrack(track)) parts.push('gemini');
  if (!isOriginalCaptionTrack(track)) parts.push('translated');
  return parts.join('/');
}

/**
 * Summarize why a player response did or did not yield a caption track.
 * A blocked or gated response carries a playability status but no tracks,
 * which is otherwise indistinguishable from a video that simply has none.
 */
export function describeCaptionAvailability(
  value: unknown,
): YouTubeCaptionAvailability {
  const playability = asRecord(
    asRecord(parseJsonValue(value))?.playabilityStatus,
  );
  const renderer = findTrackListRenderer(value);
  const list = readCaptionTrackList(value);

  return {
    ...(optionalString(playability?.status)
      ? { playabilityStatus: optionalString(playability?.status) }
      : {}),
    ...(optionalString(playability?.reason)
      ? { playabilityReason: optionalString(playability?.reason) }
      : {}),
    advertisedTrackCount: Array.isArray(renderer?.captionTracks)
      ? renderer.captionTracks.length
      : 0,
    usableTrackCount: list?.captionTracks.length ?? 0,
    tracks: (list?.captionTracks ?? []).map(describeTrack),
  };
}

/** Format JSON3's millisecond timestamp using YouTube's line timestamp shape. */
export function formatCaptionTimestamp(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return '0:00';

  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const twoDigits = (value: number) => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${totalMinutes}:${twoDigits(seconds)}`;
}

function readJson3Payload(value: unknown): RecordValue | null {
  const payload = asRecord(parseJsonValue(value));
  return payload && Array.isArray(payload.events) ? payload : null;
}

/**
 * Parse a JSON3 caption response into the existing `[timestamp] text` lines.
 * Empty, malformed, and control-only payloads return `null`.
 */
export function parseJson3Captions(value: unknown): string | null {
  const payload = readJson3Payload(value);
  if (!payload) return null;

  const lines: string[] = [];
  for (const rawEvent of payload.events as unknown[]) {
    const event = asRecord(rawEvent);
    if (!event || !Array.isArray(event.segs)) continue;

    const startMs = finiteNumber(event.tStartMs);
    if (startMs === undefined || startMs < 0) continue;

    const text = event.segs
      .map((rawSegment) => optionalString(asRecord(rawSegment)?.utf8) ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;

    lines.push(`[${formatCaptionTimestamp(startMs)}] ${text}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
