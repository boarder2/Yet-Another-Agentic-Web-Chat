import { braveLLMProvider } from './braveLLM';
import { braveSearchProvider } from './braveSearch';
import { mojeekProvider } from './mojeek';
import { searxngProvider } from './searxng';
import { ALL_PROVIDER_IDS, SearchProvider, SearchProviderId } from './types';

const providers: Record<SearchProviderId, SearchProvider> = {
  searxng: searxngProvider,
  brave_search: braveSearchProvider,
  brave_llm: braveLLMProvider,
  mojeek: mojeekProvider,
};

export const getProviderById = (id: SearchProviderId): SearchProvider => {
  return providers[id] ?? providers.searxng;
};

export const getAllProviders = (): SearchProvider[] =>
  ALL_PROVIDER_IDS.map((id) => providers[id]);
