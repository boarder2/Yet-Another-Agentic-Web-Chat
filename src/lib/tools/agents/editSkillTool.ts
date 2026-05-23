import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import crypto from 'crypto';
import { isSoftStop } from '@/lib/utils/runControl';
import { waitForApprovalResponse } from '@/lib/skills/pendingEdits';
import {
  createUserSkill,
  updateUserSkill,
  deleteUserSkill,
  getUserSkillByName,
} from '@/lib/skills/service';

const EditSkillSchema = z.object({
  action: z
    .enum(['create', 'update', 'delete'])
    .describe('The operation to perform on the user skill.'),
  name: z.string().describe('The skill name.'),
  description: z
    .string()
    .optional()
    .describe('Short description shown in autocomplete. Required for create.'),
  content: z
    .string()
    .optional()
    .describe('Full markdown body of the skill. Required for create/update.'),
  scope: z
    .enum(['global', 'workspace'])
    .optional()
    .default('global')
    .describe(
      'Whether this skill applies globally or to the current workspace only.',
    ),
});

export const editSkillTool = tool(
  async (input: z.infer<typeof EditSkillSchema>, config?: RunnableConfig) => {
    const messageId = config?.configurable?.messageId as string | undefined;
    const emitter = config?.configurable?.emitter;
    const workspaceId = config?.configurable?.workspaceId as
      | string
      | null
      | undefined;
    const interactiveSession =
      config?.configurable?.interactiveSession === true;
    const toolCallId =
      (config as unknown as { toolCall?: { id?: string } })?.toolCall?.id ??
      'edit_skill';

    if (messageId && isSoftStop(messageId)) {
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

    if (!interactiveSession || !emitter) {
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content:
                'Skill editing requires an interactive session. It is unavailable in subagents.',
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    const { action, name, description, content, scope } = input;
    const effectiveWorkspaceId =
      scope === 'workspace' ? (workspaceId ?? null) : null;

    // For create, description and content are required
    if (action === 'create') {
      if (!description || !content) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content:
                  'Error: description and content are required for create.',
                tool_call_id: toolCallId,
              }),
            ],
          },
        });
      }
    }

    // Fetch existing skill if update/delete
    let existingSkill: Awaited<ReturnType<typeof getUserSkillByName>> =
      undefined as unknown as Awaited<ReturnType<typeof getUserSkillByName>>;
    if (action === 'update' || action === 'delete') {
      existingSkill = await getUserSkillByName(name, effectiveWorkspaceId);
      if (!existingSkill) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: `Error: No user skill named "${name}" found in the ${scope ?? 'global'} scope.`,
                tool_call_id: toolCallId,
              }),
            ],
          },
        });
      }
    }

    const approvalId = crypto.randomUUID();

    // Build diff payload
    const oldContent =
      action === 'create' ? '' : (existingSkill?.content ?? '');
    const oldDescription =
      action === 'create' ? '' : (existingSkill?.description ?? '');
    const newContent = action === 'delete' ? '' : (content ?? oldContent);
    const newDescription =
      action === 'delete' ? '' : (description ?? oldDescription);

    emitter.emit(
      'data',
      JSON.stringify({
        type: 'skill_edit_approval_pending',
        data: {
          approvalId,
          toolCallId,
          action,
          name,
          oldDescription,
          newDescription,
          oldContent,
          newContent,
          scope: scope ?? 'global',
          workspaceId: effectiveWorkspaceId,
          skillId: existingSkill?.id,
          createdAt: Date.now(),
        },
        messageId,
      }),
    );

    const result = await waitForApprovalResponse(
      approvalId,
      900_000,
      messageId,
    );

    if (result.timedOut || result.decision === 'reject') {
      const reason = result.freeformText
        ? `: ${result.freeformText}`
        : result.timedOut
          ? ' (timed out)'
          : '';
      emitter.emit(
        'data',
        JSON.stringify({
          type: 'skill_edit_approval_answered',
          data: {
            approvalId,
            decision: result.decision,
            timedOut: result.timedOut,
          },
        }),
      );
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: `Skill edit rejected${reason}.`,
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    // Apply the change
    try {
      if (action === 'create') {
        await createUserSkill({
          name,
          description: newDescription,
          content: newContent,
          workspaceId: effectiveWorkspaceId,
        });
      } else if (action === 'update' && existingSkill) {
        await updateUserSkill(existingSkill.id, {
          description:
            newDescription !== oldDescription ? newDescription : undefined,
          content: newContent !== oldContent ? newContent : undefined,
        });
      } else if (action === 'delete' && existingSkill) {
        await deleteUserSkill(existingSkill.id);
      }

      emitter.emit(
        'data',
        JSON.stringify({
          type: 'skill_edit_approval_answered',
          data: { approvalId, decision: result.decision },
        }),
      );

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: `Skill "${name}" ${action}d successfully.`,
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    } catch (err) {
      console.error('[editSkillTool] Error applying skill change:', err);
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: `Error applying skill change: ${err instanceof Error ? err.message : String(err)}`,
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'edit_skill',
    description:
      'Create, update, or delete a user skill. Requires user approval before applying changes.',
    schema: EditSkillSchema,
  },
);
