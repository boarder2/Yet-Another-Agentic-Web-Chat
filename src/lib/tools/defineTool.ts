import 'server-only';

import { tool as coreTool } from 'langchain';
import type { ToolRuntime } from '@langchain/core/tools';
import type {
  InferInteropZodOutput,
  InteropZodObject,
} from '@langchain/core/utils/types';
import { Command } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { isSoftStop } from '@/lib/utils/runControl';
import { toolContextSchema, type ToolContext } from './toolContext';
import {
  persistFromToolContext,
  type ContextRowKind,
} from '@/lib/utils/persistToolContext';

/** Whether the run this context belongs to has been soft-stopped. */
export function isContextSoftStopped(context: ToolContext): boolean {
  return !!(context.messageId && isSoftStop(context.messageId));
}

/** The standard soft-stop bail-out: same shape every tool returns. */
export function softStopCommand(toolCallId: string): Command {
  return new Command({
    update: {
      messages: [
        new ToolMessage({
          content: 'Operation stopped by user.',
          tool_call_id: toolCallId,
        }),
      ],
    },
  });
}

type PersistArgs = {
  kind: ContextRowKind;
  body: string;
  metadataExtras?: Record<string, unknown>;
};

/** The runtime handed to `defineTool` handlers: native `ToolRuntime` plus a `persist` convenience. */
export type DefineToolRuntime<TState = unknown> = ToolRuntime<
  TState,
  typeof toolContextSchema
> & {
  persist: (args: PersistArgs) => Promise<void>;
};

interface DefineToolFields<
  SchemaT extends InteropZodObject,
  NameT extends string,
> {
  name: NameT;
  description: string;
  schema: SchemaT;
}

/**
 * Wraps `langchain`'s `tool()` so handlers get a typed `ToolContext` (see
 * `toolContext.ts`) via native `ToolRuntime` instead of hand-parsing
 * `RunnableConfig.configurable`. Before the handler runs, soft-stop is
 * enforced structurally — every `defineTool` tool honors it, closing the gap
 * where some tools checked `isSoftStop` and others silently didn't.
 */
export function defineTool<
  SchemaT extends InteropZodObject,
  NameT extends string,
  TState = unknown,
>(
  handler: (
    input: InferInteropZodOutput<SchemaT>,
    runtime: DefineToolRuntime<TState>,
  ) => unknown,
  fields: DefineToolFields<SchemaT, NameT>,
) {
  return coreTool(
    async (
      input: InferInteropZodOutput<SchemaT>,
      runtime: ToolRuntime<TState, typeof toolContextSchema>,
    ) => {
      const { context } = runtime;
      if (isContextSoftStopped(context)) {
        return softStopCommand(runtime.toolCallId);
      }

      const augmented: DefineToolRuntime<TState> = {
        ...runtime,
        persist: (args: PersistArgs) =>
          persistFromToolContext({ context, ...args }),
      };

      return handler(input, augmented);
    },
    fields,
  );
}
