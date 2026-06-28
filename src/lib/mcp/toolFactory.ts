import 'server-only';

import {
  tool,
  DynamicStructuredTool,
  type ToolSchemaBase,
} from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { ToolMessage } from '@langchain/core/messages';
import { Command, interrupt } from '@langchain/langgraph';
import type { EventEmitter } from 'node:events';
import { isSoftStop } from '@/lib/utils/runControl';
import {
  callMcpTool,
  getEnabledServerToolConfigs,
  getToolDescriptorsForEnabledServers,
} from './manager';
import { resolveToolSetting, type McpToolDescriptor } from './types';

// ── Tool factory ──────────────────────────────────────────────────────────

export interface McpToolFactoryOpts {
  emitter: EventEmitter;
  interactiveSession: boolean;
  messageId: string;
}

/**
 * Build LangChain DynamicStructuredTools for all enabled MCP servers.
 * MCP tools are approval-gated via interrupt(). Non-interactive sessions
 * (panel executors, subagents) get a stub that always returns an error message.
 *
 * The abort signal for in-flight calls is read from RunnableConfig.configurable
 * at call time (same pattern as simpleWebSearchTool).
 */
export async function buildMcpLangchainTools(
  opts: McpToolFactoryOpts,
): Promise<DynamicStructuredTool[]> {
  const [descriptors, configs] = await Promise.all([
    getToolDescriptorsForEnabledServers(),
    getEnabledServerToolConfigs(),
  ]);
  const tools: DynamicStructuredTool[] = [];
  for (const descriptor of descriptors) {
    const { enabled, requiresApproval } = resolveToolSetting(
      configs.get(descriptor.serverId),
      descriptor.toolName,
    );
    // Disabled tools are never injected — the model never sees them.
    if (!enabled) continue;
    tools.push(buildToolForDescriptor(descriptor, opts, requiresApproval));
  }
  return tools;
}

/**
 * Build a single LangChain tool for a given MCP descriptor.
 * Exposed separately so doResume can pin and reconstruct one specific tool
 * from its persisted payload without re-discovering all servers.
 *
 * `requiresApproval` defaults to true so resume-path reconstructions (which only
 * ever rebuild tools that already interrupted) keep their approval gate.
 */
export function buildToolForDescriptor(
  descriptor: McpToolDescriptor,
  opts: McpToolFactoryOpts,
  requiresApproval = true,
): DynamicStructuredTool {
  // MCP tool inputSchema is JSON Schema; @langchain/core accepts it directly
  // (validated via @cfworker/json-schema), so no Zod conversion is needed.
  const inputSchema =
    descriptor.inputSchema && typeof descriptor.inputSchema === 'object'
      ? descriptor.inputSchema
      : {};

  return tool(
    async (
      args: Record<string, unknown>,
      config?: RunnableConfig,
    ): Promise<Command | ToolMessage | string> => {
      const toolCallId =
        (config as unknown as { toolCall?: { id?: string } })?.toolCall?.id ??
        descriptor.namespacedName;

      const makeMsg = (content: string) =>
        new Command({
          update: {
            messages: [new ToolMessage({ content, tool_call_id: toolCallId })],
          },
        });

      // Non-interactive (panel executors, subagents): MCP tools not available
      if (!opts.interactiveSession) {
        return makeMsg(
          'MCP tools require an interactive session and cannot be used here.',
        );
      }

      // Soft-stop check
      if (isSoftStop(opts.messageId)) {
        return makeMsg('Operation stopped by user.');
      }

      // Approval interrupt — skipped for auto-run tools (approval: 'never').
      if (requiresApproval) {
        const response: unknown = interrupt({
          kind: 'mcp_tool',
          toolCallId,
          // markupKey matches namespacedName — used by handleToolStart correlation
          markupKey: descriptor.namespacedName,
          payload: {
            serverId: descriptor.serverId,
            serverName: descriptor.serverName,
            toolName: descriptor.toolName,
            namespacedName: descriptor.namespacedName,
            description: descriptor.description,
            arguments: args,
            createdAt: Date.now(),
            // Pin descriptor so doResume can reconstruct this tool without re-discovery
            _descriptorSnapshot: {
              serverId: descriptor.serverId,
              serverName: descriptor.serverName,
              toolName: descriptor.toolName,
              namespacedName: descriptor.namespacedName,
              description: descriptor.description,
              inputSchema: descriptor.inputSchema,
            },
          },
          snapshot: null,
        });

        const res = response as
          | { approved?: boolean; __cancelled?: boolean }
          | null
          | undefined;
        if (!res || res.__cancelled) {
          return makeMsg('Tool call cancelled by user.');
        }
        if (res.approved !== true) {
          return makeMsg(`User declined to run ${descriptor.toolName}.`);
        }
      }

      // Retrieve abort signal from configurable (same pattern as other tools)
      const signal = (
        config?.configurable as Record<string, unknown> | undefined
      )?.retrievalSignal as AbortSignal | undefined;

      // Execute the tool
      try {
        const { content, isError } = await callMcpTool(
          descriptor.serverId,
          descriptor.toolName,
          args,
          { signal, timeout: 60_000 },
        );
        if (isError) {
          return makeMsg(`MCP tool error: ${content}`);
        }
        return makeMsg(content);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return makeMsg(`MCP tool call failed: ${msg}`);
      }
    },
    {
      name: descriptor.namespacedName,
      description: descriptor.description || `MCP tool: ${descriptor.toolName}`,
      schema: inputSchema as ToolSchemaBase,
    },
  ) as DynamicStructuredTool;
}
