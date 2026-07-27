import { z } from 'zod';
import { ToolMessage } from '@langchain/core/messages';
import { Command, interrupt } from '@langchain/langgraph';
import { defineTool } from '@/lib/tools/defineTool';
import {
  createUserSkill,
  updateUserSkill,
  deleteUserSkill,
  getUserSkillByName,
} from '@/lib/skills/service';
import {
  SKILL_NAME_REGEX,
  SKILL_NAME_DESCRIPTION,
} from '@/lib/skills/validation';
import { isSystemSkillName } from '@/lib/skills/systemRegistry';
import { createHash } from 'crypto';

const EditSkillSchema = z.object({
  action: z
    .enum(['create', 'update', 'delete'])
    .describe('The operation to perform on the user skill.'),
  name: z
    .string()
    .regex(SKILL_NAME_REGEX, SKILL_NAME_DESCRIPTION)
    .describe(`The skill name. ${SKILL_NAME_DESCRIPTION}`),
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
      'Whether this skill applies globally or to the current workspace only. For update/delete this locates the skill; a workspace scope never falls through to a global skill of the same name.',
    ),
  newScope: z
    .enum(['global', 'workspace'])
    .optional()
    .describe(
      'Update only: move the skill to this scope. Omit to leave the scope unchanged.',
    ),
  disableModelInvocation: z
    .boolean()
    .optional()
    .describe(
      "When true, the skill is hidden from the model's auto-invocation list. It can still be invoked via slash command.",
    ),
});

export const editSkillTool = defineTool(
  async (input: z.infer<typeof EditSkillSchema>, runtime) => {
    const { workspaceId, interactiveSession, emitter } = runtime.context;
    const toolCallId = runtime.toolCallId;

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

    const {
      action,
      name,
      description,
      content,
      scope,
      newScope,
      disableModelInvocation,
    } = input;
    const effectiveWorkspaceId =
      scope === 'workspace' ? (workspaceId ?? null) : null;

    const reply = (message: string) =>
      new Command({
        update: {
          messages: [
            new ToolMessage({ content: message, tool_call_id: toolCallId }),
          ],
        },
      });

    if (newScope && action !== 'update') {
      return reply('Error: newScope is only valid for action "update".');
    }
    if ((scope === 'workspace' || newScope === 'workspace') && !workspaceId) {
      return reply(
        'Error: workspace scope requires an active workspace, but this chat has none.',
      );
    }
    const targetWorkspaceId = newScope
      ? newScope === 'workspace'
        ? (workspaceId ?? null)
        : null
      : effectiveWorkspaceId;

    // Look up the existing skill for every action. Update/delete require it to
    // exist; create requires it to NOT exist. Fetching it unconditionally also
    // lets the staleness snapshot below record the true state at proposal time
    // (a create-path that skips this would always record existingSkillExists:
    // false, falsely tripping the resume-time guard for already-present skills).
    const existingSkill = await getUserSkillByName(name, effectiveWorkspaceId);

    if (action === 'create') {
      if (!description || !content) {
        return reply('Error: description and content are required for create.');
      }
      if (isSystemSkillName(name)) {
        return reply(
          `Error: "${name}" is reserved by a built-in system skill and cannot be created as a user skill.`,
        );
      }
      if (existingSkill) {
        return reply(
          `Error: A skill named "${name}" already exists in the ${scope ?? 'global'} scope. Use action "update" to modify it.`,
        );
      }
    }

    if ((action === 'update' || action === 'delete') && !existingSkill) {
      return reply(
        `Error: No user skill named "${name}" found in the ${scope ?? 'global'} scope.`,
      );
    }

    const isMove = targetWorkspaceId !== effectiveWorkspaceId;
    if (isMove && (await getUserSkillByName(name, targetWorkspaceId))) {
      return reply(
        `Error: A skill named "${name}" already exists in the ${newScope} scope, so it cannot be moved there.`,
      );
    }

    // Build diff payload
    const oldContent =
      action === 'create' ? '' : (existingSkill?.content ?? '');
    const oldDescription =
      action === 'create' ? '' : (existingSkill?.description ?? '');
    const oldDisableModelInvocation =
      action === 'create'
        ? false
        : (existingSkill?.disableModelInvocation ?? false);
    const newContent = action === 'delete' ? '' : (content ?? oldContent);
    const newDescription =
      action === 'delete' ? '' : (description ?? oldDescription);
    const newDisableModelInvocation =
      action === 'delete'
        ? false
        : (disableModelInvocation ?? oldDisableModelInvocation);

    // Stale-state snapshot for resume validation
    const snapshot = {
      existingSkillContentHash: oldContent
        ? createHash('sha256').update(oldContent).digest('hex')
        : null,
      existingSkillExists: !!existingSkill,
    };

    const response: unknown = interrupt({
      kind: 'skill_edit',
      toolCallId,
      markupKey: name,
      payload: {
        action,
        name,
        oldDescription,
        newDescription,
        oldContent,
        newContent,
        scope: scope ?? 'global',
        newScope: isMove ? newScope : undefined,
        workspaceId: effectiveWorkspaceId,
        skillId: existingSkill?.id,
        oldDisableModelInvocation,
        disableModelInvocation: newDisableModelInvocation,
        createdAt: Date.now(),
      },
      snapshot,
    });

    // Cancellation discriminator
    if (response && (response as Record<string, unknown>).__cancelled) {
      return reply('Skill edit cancelled by user.');
    }

    // Stale discriminator: the skill changed while awaiting approval, so the
    // approved diff no longer applies. Surface it so the agent re-reads + retries.
    if (response && (response as Record<string, unknown>).__stale) {
      const reason = (response as { reason?: string }).reason;
      return reply(
        `${reason ?? 'The skill changed since this edit was proposed.'} Re-read it with \`read_skill\` and propose the change again.`,
      );
    }

    const result = response as {
      decision: 'accept' | 'reject';
      freeformText?: string;
    };

    if (result.decision === 'reject') {
      const reason = result.freeformText ? `: ${result.freeformText}` : '';
      return reply(`Skill edit rejected${reason}.`);
    }

    // Apply the change
    try {
      if (action === 'create') {
        await createUserSkill({
          name,
          description: newDescription,
          content: newContent,
          workspaceId: effectiveWorkspaceId,
          disableModelInvocation: newDisableModelInvocation,
        });
      } else if (action === 'update' && existingSkill) {
        await updateUserSkill(existingSkill.id, {
          description:
            newDescription !== oldDescription ? newDescription : undefined,
          content: newContent !== oldContent ? newContent : undefined,
          workspaceId: isMove ? targetWorkspaceId : undefined,
          disableModelInvocation:
            newDisableModelInvocation !== oldDisableModelInvocation
              ? newDisableModelInvocation
              : undefined,
        });
      } else if (action === 'delete' && existingSkill) {
        await deleteUserSkill(existingSkill.id);
      }

      return reply(
        `Skill "${name}" ${action}d successfully${isMove ? ` and moved to the ${newScope} scope` : ''}.`,
      );
    } catch (err) {
      console.error('[editSkillTool] Error applying skill change:', err);
      return reply(
        `Error applying skill change: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
  {
    name: 'edit_skill',
    description: `Create, update, or delete a user skill. Requires user approval before applying changes. Name rules: ${SKILL_NAME_DESCRIPTION}`,
    schema: EditSkillSchema,
  },
);
