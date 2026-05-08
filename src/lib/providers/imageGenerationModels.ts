import { getOpenrouterApiKey } from '../config';
import {
  getCachedImageGenerationModels,
  setCachedImageGenerationModels,
  NEGATIVE_CACHE_TTL_MS,
} from './modelCache';

export interface ImageGenerationModel {
  id: string;
  name: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getAvailableImageGenerationModels(options?: {
  forceRefresh?: boolean;
}): Promise<ImageGenerationModel[]> {
  const provider = 'openrouter';

  if (!options?.forceRefresh) {
    const cached =
      getCachedImageGenerationModels<ImageGenerationModel[]>(provider);
    if (cached !== null) return cached;
  }

  const apiKey = getOpenrouterApiKey();
  if (!apiKey) {
    setCachedImageGenerationModels(provider, [], NEGATIVE_CACHE_TTL_MS);
    return [];
  }

  try {
    const res = await fetch(
      'https://openrouter.ai/api/v1/models?output_modalities=image',
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!res.ok) {
      setCachedImageGenerationModels(provider, [], NEGATIVE_CACHE_TTL_MS);
      return [];
    }

    const data = await res.json();
    const models: ImageGenerationModel[] = (data.data || [])
      .filter((m: Record<string, unknown>) => {
        const arch = m.architecture as Record<string, unknown> | undefined;
        return (
          Array.isArray(arch?.output_modalities) &&
          (arch?.output_modalities as string[]).includes('image')
        );
      })
      .map((m: Record<string, unknown>) => ({
        id: String(m.id || ''),
        name: String(m.name || m.id || ''),
      }))
      .sort((a: ImageGenerationModel, b: ImageGenerationModel) =>
        a.name.localeCompare(b.name),
      );

    setCachedImageGenerationModels(provider, models, CACHE_TTL_MS);
    return models;
  } catch {
    setCachedImageGenerationModels(provider, [], NEGATIVE_CACHE_TTL_MS);
    return [];
  }
}
