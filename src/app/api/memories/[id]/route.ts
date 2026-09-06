import db from '@/lib/db';
import { memories } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { classifyMemory, MemoryCategory } from '@/lib/utils/memoryCategories';
import { embedMemoryContent } from '@/lib/utils/memoryEmbedding';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import {
  getEmbeddingModelSelection,
  getMemoryModelSelection,
} from '@/lib/settings/server';
import { badRequest, notFound, route } from '@/lib/api/route';

async function getEmbeddingModel(): Promise<CachedEmbeddings | null> {
  const providers = await getAvailableEmbeddingModelProviders();
  const selected = getEmbeddingModelSelection();

  const selectionPresent = selected.provider !== '' || selected.name !== '';
  if (selectionPresent) {
    const provider = providers[selected.provider];
    if (!provider?.[selected.name]) {
      throw new Error('Invalid embedding model');
    }
    return new CachedEmbeddings(
      provider[selected.name].model,
      selected.provider,
      selected.name,
    );
  }

  const defaultProvider = Object.keys(providers)[0];
  if (!defaultProvider) return null;
  const provider = providers[defaultProvider];
  const defaultModel = Object.keys(provider)[0];
  if (!defaultModel) return null;
  return new CachedEmbeddings(
    provider[defaultModel].model,
    defaultProvider,
    defaultModel,
  );
}

async function getMemoryModel() {
  const providers = await getAvailableChatModelProviders();
  const selected = getMemoryModelSelection();

  const selectionPresent = selected.provider !== '' || selected.name !== '';
  if (selectionPresent) {
    const provider = providers[selected.provider];
    if (!provider?.[selected.name]) {
      throw new Error('Invalid memory model');
    }
    return provider[selected.name].model;
  }

  for (const provider of Object.values(providers)) {
    for (const modelName of Object.keys(provider)) {
      return provider[modelName].model;
    }
  }
  return null;
}

type Ctx = { params: Promise<{ id: string }> };

async function requireMemory(params: Ctx['params']) {
  const { id } = await params;
  const memory = await db.query.memories.findFirst({
    where: eq(memories.id, id),
  });
  if (!memory) throw notFound('Memory not found');
  return { id, memory };
}

export const GET = route(
  'Failed to fetch memory',
  async (_req: Request, { params }: Ctx) =>
    Response.json((await requireMemory(params)).memory),
);

export const PUT = route(
  'Failed to update memory',
  async (req: Request, { params }: Ctx) => {
    const { content } = await req.json();
    if (typeof content !== 'string' || !content.trim()) {
      throw badRequest('Content is required');
    }

    const { id, memory } = await requireMemory(params);
    const trimmed = content.trim();
    const [embeddingModel, systemModel] = await Promise.all([
      getEmbeddingModel(),
      getMemoryModel(),
    ]);

    const embedding = embeddingModel
      ? await embedMemoryContent(trimmed, embeddingModel)
      : null;
    const category: MemoryCategory = systemModel
      ? await classifyMemory(trimmed, systemModel)
      : (memory.category as MemoryCategory) || 'Preference';

    const [updated] = await db
      .update(memories)
      .set({
        content: trimmed,
        embedding: embedding ? JSON.stringify(embedding) : memory.embedding,
        embeddingModel:
          embeddingModel?.getIdentifier() ?? memory.embeddingModel,
        category,
        updatedAt: new Date(),
      })
      .where(eq(memories.id, id))
      .returning();

    return Response.json(updated);
  },
);

export const DELETE = route(
  'Failed to delete memory',
  async (_req: Request, { params }: Ctx) => {
    const { id } = await requireMemory(params);
    await db.delete(memories).where(eq(memories.id, id)).execute();
    return Response.json({ success: true });
  },
);
