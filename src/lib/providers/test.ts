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

// Deterministic args for the tool `withStructuredOutput` binds for a given
// schema name. Only the real call sites in the app need an entry; unknown
// names fall back to an empty object.
const STRUCTURED_TOOL_ARGS: Record<string, Record<string, unknown>> = {
  generate_topics: {
    topics: ['deterministic topic one', 'deterministic topic two'],
  },
};

const STRUCTURED_SUGGESTIONS_ANSWER = [
  '<suggestions>',
  'What else should I know about this topic?',
  'How does this compare to related approaches?',
  'What are the practical next steps?',
  '</suggestions>',
].join('\n');

class FakeChatModel extends BaseChatModel {
  modelName: string;
  // Tool names bound via bindTools() — populated when `withStructuredOutput`
  // forces a single schema-derived tool, so this instance can answer with a
  // matching tool_call instead of plain text.
  private boundToolNames: string[];

  constructor(
    fields: {
      modelName: string;
      boundToolNames?: string[];
    } & BaseChatModelParams,
  ) {
    const { modelName, boundToolNames, ...rest } = fields;
    super(rest);
    this.modelName = modelName;
    this.boundToolNames = boundToolNames ?? [];
  }

  _llmType(): string {
    return 'test';
  }

  _combineLLMOutput(): [] {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(tools: any[]): this {
    // Only recognize the OpenAI-function-shaped tool def that
    // withStructuredOutput's default implementation constructs
    // (`{ type: 'function', function: { name, ... } }`) — real agent tools
    // (StructuredTool instances with a top-level `.name`) must NOT count,
    // or every ordinary tool-bound agent run (i.e. every focus mode) would
    // hit the structured-output branch below and loop forever emitting
    // tool calls instead of ever answering.
    const boundToolNames = tools
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((t: any) => t?.function?.name)
      .filter((n: unknown): n is string => typeof n === 'string');
    return new FakeChatModel({
      modelName: this.modelName,
      boundToolNames,
    }) as this;
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const hasToolResult = messages.some((m) => m.getType() === 'tool');
    const toolResultCount = messages.filter(
      (m) => m.getType() === 'tool',
    ).length;

    // withStructuredOutput binds exactly one schema-derived tool and forces
    // it — answer with a matching tool_call instead of introspecting intent.
    if (this.boundToolNames.length > 0) {
      const toolName = this.boundToolNames[0];
      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({
          content: '',
          tool_calls: [
            {
              name: toolName,
              args: STRUCTURED_TOOL_ARGS[toolName] ?? {},
              id: 'test-structured-call-1',
              type: 'tool_call',
            },
          ],
          usage_metadata: {
            input_tokens: 10,
            output_tokens: 4,
            total_tokens: 14,
          },
        }),
      });
      return;
    }

    if (this.modelName.includes('ask-user') && !hasToolResult) {
      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({
          content: '',
          tool_calls: [
            {
              name: 'ask_user',
              args: {
                question: 'Which color do you prefer?',
                options: [{ label: 'Red' }, { label: 'Blue' }],
                multiSelect: false,
                allowFreeformInput: true,
                context: 'Testing the ask_user interrupt flow.',
              },
              id: 'test-ask-user-call-1',
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

    if (this.modelName.includes('tool-multi') && toolResultCount < 2) {
      const step = toolResultCount + 1;
      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({
          content: '',
          tool_calls: [
            {
              name: 'file_search',
              args: { query: `${lastHumanText(messages)} (step ${step})` },
              id: `test-multi-tool-call-${step}`,
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

    let answer: string;
    if (this.modelName.includes('ask-user')) {
      answer = 'Thanks for your answer — resuming now.';
    } else if (this.modelName.includes('tool-multi')) {
      answer =
        'Based on the documents, the multi-step answer is deterministic.';
    } else if (this.modelName.includes('structured')) {
      answer = STRUCTURED_SUGGESTIONS_ANSWER;
    } else {
      answer = hasToolResult
        ? 'Based on the document, the answer is deterministic.'
        : 'This is a deterministic test answer.';
    }

    const slow = this.modelName.includes('slow');
    const tokens = answer.split(/(?<=\s)/);
    for (let i = 0; i < tokens.length; i++) {
      // Paced delivery so tests can deterministically observe a run
      // mid-stream (cancel, reload/reattach) before it completes.
      if (slow) await new Promise((resolve) => setTimeout(resolve, 300));
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
    'test-tool-multi': {
      displayName: 'Test (multi-step tool loop)',
      model: new FakeChatModel({
        modelName: 'test-tool-multi',
      }) as unknown as BaseChatModel,
    },
    'test-ask-user': {
      displayName: 'Test (ask user)',
      model: new FakeChatModel({
        modelName: 'test-ask-user',
      }) as unknown as BaseChatModel,
    },
    'test-structured': {
      displayName: 'Test (structured output)',
      model: new FakeChatModel({
        modelName: 'test-structured',
      }) as unknown as BaseChatModel,
    },
    'test-slow': {
      displayName: 'Test (slow stream)',
      model: new FakeChatModel({
        modelName: 'test-slow',
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
