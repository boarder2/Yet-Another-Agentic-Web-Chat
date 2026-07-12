import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import { ToolMessage } from '@langchain/core/messages';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { z } from 'zod';
import { SubagentExecutor } from '@/lib/search/subagents/executor';
import { getSubagentDefinition } from '@/lib/search/subagents/definitions';
import { defineTool } from '@/lib/tools/defineTool';

// Schema for deep research tool input
const DeepResearchToolSchema = z.object({
  task: z.string().describe('Focused task with all needed context.'),
});

/**
 * DeepResearchTool - Spawns a focused research subagent for comprehensive investigation
 *
 * This tool creates a SubagentExecutor that runs an independent SimplifiedAgent
 * instance with web research tools (web_search, url_fetch, image_search,
 * pdf_loader). The subagent does NOT have access to deep_research
 * itself, preventing recursion.
 *
 * Use this when the main agent discovers that a sub-problem requires significantly
 * more investigation than a single web search can provide.
 */
export const deepResearchTool = defineTool(
  async (input: z.infer<typeof DeepResearchToolSchema>, runtime) => {
    try {
      const { task } = input;

      // Get current state for conversation history context
      const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;

      const {
        llm: chatLlm,
        systemLlm,
        embeddings,
        emitter,
        retrievalSignal,
        messageId = 'unknown',
        fileIds = [],
        userLocation,
        userProfile,
        tracker,
      } = runtime.context;
      const signal = runtime.signal;

      // Validate required config
      if (!chatLlm || !systemLlm || !embeddings || !emitter) {
        throw new Error(
          'Required configuration not available for deep_research',
        );
      }

      // Get the deep_research subagent definition
      const definition = getSubagentDefinition('deep_research');
      if (!definition) {
        throw new Error('deep_research subagent definition not found');
      }

      console.log(`DeepResearchTool: Spawning subagent for task: "${task}"`);

      const chatModelRef = tracker.rootIdentity('chat');
      const systemModelRef = tracker.rootIdentity('system');
      if (!chatModelRef || !systemModelRef) {
        throw new Error(
          'Root chat/system model identity not registered for deep_research',
        );
      }

      // Create SubagentExecutor (reuses existing infrastructure)
      const executor = new SubagentExecutor(
        definition,
        chatLlm,
        systemLlm,
        embeddings,
        emitter, // parent emitter - executor creates isolated child
        signal!,
        messageId,
        retrievalSignal, // Pass retrievalSignal for cancellation support
        userLocation,
        userProfile,
        tracker,
        chatModelRef,
        systemModelRef,
      );

      // Execute subagent with conversation history
      // SubagentExecutor already slices to last 5 messages internally
      const execution = await executor.execute(
        task,
        currentState.messages,
        fileIds,
      );

      console.log(
        `DeepResearchTool: Subagent completed with status: ${execution.status}`,
      );

      if (execution.status === 'success' && execution.summary) {
        await runtime.persist({
          kind: 'deep_research',
          body: `[deep_research task="${task}"]\n${execution.summary}`,
          metadataExtras: {
            query: task,
            documentCount: execution.documents?.length ?? 0,
          },
        });
      }

      // Return results via Command pattern
      // Documents flow back into main agent's relevantDocuments state
      // Summary goes into a ToolMessage so the agent can reason about findings
      return new Command({
        update: {
          relevantDocuments: execution.documents,
          messages: [
            new ToolMessage({
              content:
                execution.status === 'success'
                  ? `Deep research completed. Findings:\n\n${execution.summary}`
                  : `Deep research encountered an error: ${execution.error || 'Unknown error'}`,
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    } catch (error: unknown) {
      console.error('DeepResearchTool: Error:', error);

      return new Command({
        update: {
          relevantDocuments: [],
          messages: [
            new ToolMessage({
              content:
                'Error during deep research: ' +
                (error instanceof Error ? error.message : 'Unknown error'),
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'deep_research',
    description:
      'Spawn a subagent for multi-source investigation beyond a single web_search. Give one focused task with all needed context. Before first use this session, call read_skill("deep-research") for task scoping, the subagent\'s tool set, and when to parallelize.',
    schema: DeepResearchToolSchema,
  },
);
