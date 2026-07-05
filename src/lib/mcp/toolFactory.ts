import 'server-only';

import {
  tool,
  DynamicStructuredTool,
  type ToolRuntime,
  type ToolSchemaBase,
} from '@langchain/core/tools';
import { ToolMessage } from '@langchain/core/messages';
import { Command, interrupt } from '@langchain/langgraph';
import { toolContextSchema } from '@/lib/tools/toolContext';
import { isContextSoftStopped, softStopCommand } from '@/lib/tools/defineTool';
import {
  callMcpTool,
  getEnabledServerToolConfigs,
  getServerWorkspaceScopes,
  getToolDescriptorsForEnabledServers,
} from './manager';
import {
  isServerVisibleForChat,
  resolveToolSetting,
  type McpToolDescriptor,
} from './types';

// ── Tool factory ──────────────────────────────────────────────────────────

export interface McpToolFactoryOpts {
  workspaceId?: string | null;
}

/**
 * Build LangChain DynamicStructuredTools for all enabled MCP servers.
 * MCP tools are approval-gated via interrupt(). Non-interactive sessions
 * (panel executors, subagents) get a stub that always returns an error message.
 *
 * Runtime infrastructure (emitter, interactiveSession, messageId, retrieval
 * signal) is read from the tool's `ToolContext` at call time — same as local
 * tools (see `defineTool.ts`) — not passed in here. `workspaceId` stays a
 * build-time param since it filters which server tools even get constructed,
 * before `context` exists at invoke time.
 */
export async function buildMcpLangchainTools(
  opts: McpToolFactoryOpts = {},
): Promise<DynamicStructuredTool[]> {
  const [descriptors, configs, scopes] = await Promise.all([
    getToolDescriptorsForEnabledServers(),
    getEnabledServerToolConfigs(),
    getServerWorkspaceScopes(),
  ]);
  const tools: DynamicStructuredTool[] = [];
  for (const descriptor of descriptors) {
    const { enabled, requiresApproval } = resolveToolSetting(
      configs.get(descriptor.serverId),
      descriptor.toolName,
    );
    // Disabled tools are never injected — the model never sees them.
    if (!enabled) continue;
    if (
      !isServerVisibleForChat(
        scopes.get(descriptor.serverId),
        opts.workspaceId ?? null,
      )
    )
      continue;
    tools.push(buildToolForDescriptor(descriptor, requiresApproval));
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
  requiresApproval = true,
): DynamicStructuredTool {
  // MCP tool inputSchema is JSON Schema; @langchain/core accepts it directly
  // (validated via @cfworker/json-schema), so no Zod conversion is needed.
  // Dynamic JSON-Schema tools can't go through `defineTool` (Zod-only), so the
  // soft-stop + toolCallId handling below calls its shared helpers directly to
  // stay byte-for-byte identical to local tools.
  const inputSchema =
    descriptor.inputSchema && typeof descriptor.inputSchema === 'object'
      ? descriptor.inputSchema
      : {};

  return tool(
    async (
      args: Record<string, unknown>,
      runtime: ToolRuntime<unknown, typeof toolContextSchema>,
    ): Promise<Command | ToolMessage | string> => {
      const { context } = runtime;
      const toolCallId = runtime.toolCallId;

      const makeMsg = (content: string) =>
        new Command({
          update: {
            messages: [new ToolMessage({ content, tool_call_id: toolCallId })],
          },
        });

      // Non-interactive (panel executors, subagents): MCP tools not available
      if (!context.interactiveSession) {
        return makeMsg(
          'MCP tools require an interactive session and cannot be used here.',
        );
      }

      // Soft-stop check
      if (isContextSoftStopped(context)) {
        return softStopCommand(toolCallId);
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

      // Execute the tool
      try {
        const { content, isError } = await callMcpTool(
          descriptor.serverId,
          descriptor.toolName,
          args,
          { signal: context.retrievalSignal, timeout: 60_000 },
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
