import {
  BaseChatModel,
  type BaseChatModelParams,
} from '@langchain/core/language_models/chat_models';
import { AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { Embeddings, type EmbeddingsParams } from '@langchain/core/embeddings';
import type { ChatModel, EmbeddingModel } from '.';

export const PROVIDER_INFO = { key: 'test', displayName: 'Test' };

class FakeChatModel extends BaseChatModel {
  modelName: string;

  constructor(fields: { modelName: string } & BaseChatModelParams) {
    const { modelName, ...rest } = fields;
    super(rest);
    this.modelName = modelName;
  }

  _llmType(): string {
    return 'test';
  }

  _combineLLMOutput(): [] {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(_tools: any[]): this {
    return this;
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const hasToolResult = messages.some((m) => m.getType() === 'tool');

    if (this.modelName.includes('tool') && !hasToolResult) {
      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({
          content: '',
          tool_calls: [
            {
              name: 'file_search',
              args: { query: lastHumanText(messages) },
              id: 'test-tool-call-1',
              type: 'tool_call',
            },
          ],
          usage_metadata: {
            input_tokens: 12,
            output_tokens: 4,
            total_tokens: 16,
          },
        }),
      });
      return;
    }

    const answer = hasToolResult
      ? 'Based on the document, the answer is deterministic.'
      : 'This is a deterministic test answer.';

    const tokens = answer.split(/(?<=\s)/);
    for (let i = 0; i < tokens.length; i++) {
      const isLast = i === tokens.length - 1;
      const chunk = new ChatGenerationChunk({
        text: tokens[i],
        message: new AIMessageChunk({
          content: tokens[i],
          ...(isLast
            ? {
                usage_metadata: {
                  input_tokens: 12,
                  output_tokens: tokens.length,
                  total_tokens: 12 + tokens.length,
                },
              }
            : {}),
        }),
      });
      await runManager?.handleLLMNewToken(tokens[i]);
      yield chunk;
    }
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    let text = '';
    let message: AIMessageChunk | undefined;
    for await (const c of this._streamResponseChunks(
      messages,
      options,
      runManager,
    )) {
      text += c.text;
      message = message
        ? message.concat(c.message as AIMessageChunk)
        : (c.message as AIMessageChunk);
    }
    return {
      generations: [
        {
          text,
          message: message ?? new AIMessageChunk({ content: '' }),
        },
      ],
    };
  }
}

class FakeEmbeddings extends Embeddings {
  private dims = 384;

  constructor(params?: EmbeddingsParams) {
    super(params ?? {});
  }

  async embedQuery(text: string): Promise<number[]> {
    return hashVector(text, this.dims);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((t) => hashVector(t, this.dims));
  }
}

function hashVector(text: string, dims: number): number[] {
  const vec = new Array(dims);
  for (let i = 0; i < dims; i++) {
    let h = 0;
    for (let j = 0; j < text.length; j++) {
      h = ((h << 5) - h + text.charCodeAt(j) + i * 31) | 0;
    }
    vec[i] = Math.tanh(h * 0.001);
  }
  // Normalize to unit length
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  for (let i = 0; i < dims; i++) vec[i] /= norm;
  return vec;
}

function lastHumanText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.getType() === 'human') {
      const content = m.content;
      return typeof content === 'string' ? content : '';
    }
  }
  return '';
}

export async function loadTestChatModels(): Promise<Record<string, ChatModel>> {
  if (process.env.YAAWC_TEST_MODE !== 'true') return {};

  return {
    'test-direct': {
      displayName: 'Test (direct)',
      model: new FakeChatModel({
        modelName: 'test-direct',
      }) as unknown as BaseChatModel,
    },
    'test-tool': {
      displayName: 'Test (tool loop)',
      model: new FakeChatModel({
        modelName: 'test-tool',
      }) as unknown as BaseChatModel,
    },
  };
}

export async function loadTestEmbeddingModels(): Promise<
  Record<string, EmbeddingModel>
> {
  if (process.env.YAAWC_TEST_MODE !== 'true') return {};

  return {
    'test-embed': {
      displayName: 'Test Embeddings',
      model: new FakeEmbeddings() as unknown as Embeddings,
    },
  };
}
