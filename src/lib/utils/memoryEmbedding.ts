import { CachedEmbeddings } from './cachedEmbeddings';

export async function embedMemoryContent(
  content: string,
  embeddingModel: CachedEmbeddings,
): Promise<number[]> {
  return embeddingModel.embedQuery(content);
}
