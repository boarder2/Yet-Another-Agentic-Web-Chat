import 'server-only';

import { tool as coreTool } from 'langchain';
import type { ToolRuntime } from '@langchain/core/tools';
import type {
  InferInteropZodOutput,
  InteropZodType,
} from '@langchain/core/utils/types';
import { toolContextSchema } from './toolContext';
import {
  persistFromToolContext,
  type ContextRowKind,
} from '@/lib/utils/persistToolContext';

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
  SchemaT extends InteropZodType,
  NameT extends string,
> {
  name: NameT;
  description: string;
  schema: SchemaT;
}

/**
 * Wraps `langchain`'s `tool()` so handlers get a typed `ToolContext` (see
 * `toolContext.ts`) via native `ToolRuntime` instead of hand-parsing
 * `RunnableConfig.configurable`.
 */
export function defineTool<
  SchemaT extends InteropZodType,
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
