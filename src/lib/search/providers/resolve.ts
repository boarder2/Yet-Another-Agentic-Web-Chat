import { getSearchProviderSelection } from '@/lib/config';
import { getProviderById } from './registry';
import {
  SearchCapabilities,
  SearchCapability,
  SearchProvider,
  SearchProviderId,
} from './types';

interface ResolveOpts {
  isPrivate?: boolean;
}

const pickPrimary = (isPrivate: boolean): SearchProviderId => {
  const sel = getSearchProviderSelection();
  if (isPrivate && sel.privateProvider) return sel.privateProvider;
  return sel.provider;
};

const pickFallback = (): SearchProviderId | null => {
  const sel = getSearchProviderSelection();
  return sel.fallbackProvider || null;
};

const warnedPairs = new Set<string>();
const warnOnce = (
  primary: SearchProviderId,
  fallback: SearchProviderId,
  capability: SearchCapability,
) => {
  const key = `${primary}->${fallback}:${capability}`;
  if (warnedPairs.has(key)) return;
  warnedPairs.add(key);
  console.warn(
    `[search] Primary provider "${primary}" does not support "${capability}"; falling back to "${fallback}".`,
  );
};

const resolveFor = (
  capability: SearchCapability,
  isPrivate: boolean,
): SearchProvider | null => {
  const primaryId = pickPrimary(isPrivate);
  const primary = getProviderById(primaryId);
  if (primary.capabilities[capability]) return primary;

  const fallbackId = pickFallback();
  if (fallbackId && fallbackId !== primaryId) {
    const fallback = getProviderById(fallbackId);
    if (fallback.capabilities[capability]) {
      warnOnce(primaryId, fallbackId, capability);
      return fallback;
    }
  }
  return null;
};

export const getWebSearchProvider = (opts: ResolveOpts = {}) => {
  // Web is mandatory; if primary doesn't support it (shouldn't happen),
  // fall back. If fallback also doesn't, return primary anyway so the
  // caller gets a coherent error from the provider.
  return (
    resolveFor('web', !!opts.isPrivate) ||
    getProviderById(pickPrimary(!!opts.isPrivate))
  );
};

export const getImageSearchProvider = (
  opts: ResolveOpts = {},
): SearchProvider | null => resolveFor('images', !!opts.isPrivate);

export const getVideoSearchProvider = (
  opts: ResolveOpts = {},
): SearchProvider | null => resolveFor('videos', !!opts.isPrivate);

// Autocomplete is a browser-search passthrough; not affected by private mode.
export const getAutocompleteProvider = (): SearchProvider | null =>
  resolveFor('autocomplete', false);

export const getResolvedSearchCapabilities = (
  isPrivate: boolean,
): SearchCapabilities => {
  return {
    web: !!resolveFor('web', isPrivate),
    images: !!resolveFor('images', isPrivate),
    videos: !!resolveFor('videos', isPrivate),
    autocomplete: !!resolveFor('autocomplete', false),
  };
};
