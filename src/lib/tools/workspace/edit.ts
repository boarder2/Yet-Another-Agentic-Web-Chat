import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { ToolMessage } from '@langchain/core/messages';
import { Command, interrupt } from '@langchain/langgraph';
import { isSoftStop } from '@/lib/utils/runControl';
import { getFileByName, replaceFile } from '@/lib/workspaces/files';
import { getText } from '@/lib/workspaces/extract';
import { hasNulByte, blobPath } from '@/lib/workspaces/paths';
import { getWorkspace } from '@/lib/workspaces/service';
import db from '@/lib/db';
import { workspaceFiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import fs from 'node:fs/promises';

const WorkspaceEditSchema = z.object({
  file: z.string().describe('Filename to edit (must exist in the workspace).'),
  oldString: z
    .string()
    .describe(
      'Exact substring to find in the current file. Must be unique unless replaceAll is true.',
    ),
  newString: z.string().describe('Replacement text for oldString.'),
  replaceAll: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Replace every occurrence of oldString. Default: false (require exactly one match).',
    ),
});

/** Count total added + removed lines in a string replacement. */
function diffLineCount(
  oldString: string,
  newString: string,
  occurrences: number,
): number {
  const removed = oldString.split('\n').length * occurrences;
  const added = newString.split('\n').length * occurrences;
  return removed + added;
}

export function workspaceEditTool(opts: {
  workspaceId: string;
  emitter: import('node:events').EventEmitter;
  interactiveSession: boolean;
  messageId: string;
}) {
  return tool(
    async (
      input: z.infer<typeof WorkspaceEditSchema>,
      config?: RunnableConfig,
    ) => {
      const toolCallId =
        (config as unknown as { toolCall?: { id?: string } })?.toolCall?.id ??
        'workspace_edit';

      const err = (code: string, hint: string) =>
        new Command({
          update: {
            messages: [
              new ToolMessage({
                content: JSON.stringify({ error: code, hint }),
                tool_call_id: toolCallId,
              }),
            ],
          },
        });

      if (isSoftStop(opts.messageId)) {
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

      if (!opts.interactiveSession || !opts.emitter) {
        return err(
          'interactive_only',
          'Editing requires an interactive session.',
        );
      }

      // 1. Resolve file
      const fileRow = await getFileByName(opts.workspaceId, input.file).catch(
        () => null,
      );
      if (!fileRow) {
        return err('file_not_found', 'List files with `workspace_ls`.');
      }

      // 2. NUL-byte sniff on blob
      const blobBytes = await fs
        .readFile(blobPath(fileRow.sha256))
        .catch(() => null);
      if (!blobBytes) {
        return err('file_not_found', 'List files with `workspace_ls`.');
      }
      if (hasNulByte(blobBytes)) {
        return err('not_editable', 'This file type is not editable.');
      }

      // 3. Load text
      const text = await getText(fileRow.sha256, fileRow.mime);
      if (text === null) {
        return err('not_editable', 'This file type is not editable.');
      }

      // 4. Validate edit
      const { oldString, newString, replaceAll } = input;
      let occurrences = 0;
      let idx = text.indexOf(oldString);
      while (idx !== -1) {
        occurrences++;
        idx = text.indexOf(oldString, idx + oldString.length);
      }

      if (occurrences === 0) {
        return err(
          'no_match',
          "Read the file with `workspace_read`; the snippet doesn't match the current contents.",
        );
      }
      if (!replaceAll && occurrences > 1) {
        return err(
          'not_unique',
          `Found ${occurrences} occurrences. Pass \`replaceAll: true\` or expand the snippet to be unique.`,
        );
      }
      if (replaceAll && occurrences > 100) {
        return err(
          'too_many_replacements',
          'Make a smaller change: narrow `oldString` so it matches fewer occurrences, or split into multiple edits.',
        );
      }
      const lineDiff = diffLineCount(
        oldString,
        newString,
        replaceAll ? occurrences : 1,
      );
      if (lineDiff > 350) {
        return err(
          'diff_too_large',
          'Make a smaller, more targeted edit and try again.',
        );
      }

      // 5. Approval gate
      const ws = await getWorkspace(opts.workspaceId);
      const workspaceAutoAccept = ws?.autoAcceptFileEdits === 1;
      const fileAutoAccept = fileRow.autoAcceptEdits; // null | 0 | 1
      const shouldPrompt =
        fileAutoAccept !== null ? fileAutoAccept === 0 : !workspaceAutoAccept;

      if (shouldPrompt) {
        // Capture stale-state snapshot for resume validation
        const snapshot = {
          workspaceAutoAccept,
          fileAutoAccept,
          existingFileSha: fileRow.sha256,
        };

        const response: unknown = interrupt({
          kind: 'workspace_edit',
          toolCallId,
          markupKey: input.file,
          payload: {
            action: 'edit',
            workspaceId: opts.workspaceId,
            fileId: fileRow.id,
            file: fileRow.name,
            oldString,
            newString,
            replaceAll,
            occurrences,
            workspaceAutoAccept,
            fileAutoAccept,
            createdAt: Date.now(),
          },
          snapshot,
        });

        // Cancellation discriminator
        if (response && (response as Record<string, unknown>).__cancelled) {
          return new Command({
            update: {
              messages: [
                new ToolMessage({
                  content: JSON.stringify({
                    error: 'cancelled_by_user',
                    hint: 'User cancelled.',
                  }),
                  tool_call_id: toolCallId,
                }),
              ],
            },
          });
        }

        // Stale discriminator: the file changed while awaiting approval, so the
        // approved diff no longer applies. Surface it so the agent re-reads + retries.
        if (response && (response as Record<string, unknown>).__stale) {
          const reason = (response as { reason?: string }).reason;
          return err(
            'stale_state',
            `${reason ?? 'The file changed since this edit was proposed.'} Re-read it with \`workspace_read\` and propose the edit again.`,
          );
        }

        const editResponse = response as {
          decision: 'accept' | 'accept_always' | 'reject' | 'always_prompt';
          freeformText?: string;
        };

        if (editResponse.decision === 'accept_always') {
          await db
            .update(workspaceFiles)
            .set({ autoAcceptEdits: 1 })
            .where(eq(workspaceFiles.id, fileRow.id));
        }

        if (
          editResponse.decision === 'reject' ||
          editResponse.decision === 'always_prompt'
        ) {
          if (editResponse.decision === 'always_prompt') {
            await db
              .update(workspaceFiles)
              .set({ autoAcceptEdits: 0 })
              .where(eq(workspaceFiles.id, fileRow.id));
          }
          const msg = editResponse.freeformText
            ? `User rejected the edit: "${editResponse.freeformText}"`
            : 'User rejected the edit.';
          return new Command({
            update: {
              messages: [
                new ToolMessage({
                  content: JSON.stringify({
                    error: 'rejected_by_user',
                    hint: msg,
                  }),
                  tool_call_id: toolCallId,
                }),
              ],
            },
          });
        }
      }

      // 6. Persist edit
      const newText = replaceAll
        ? text.split(oldString).join(newString)
        : text.replace(oldString, newString);

      const updated = await replaceFile({
        workspaceId: opts.workspaceId,
        fileId: fileRow.id,
        bytes: Buffer.from(newText, 'utf8'),
      });

      opts.emitter.emit(
        'data',
        JSON.stringify({
          type: 'workspace_file_changed',
          data: {
            workspaceId: opts.workspaceId,
            file: input.file,
            action: 'edit',
          },
        }),
      );

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: JSON.stringify({
                ok: true,
                file: input.file,
                occurrences: replaceAll ? occurrences : 1,
                newSha256: updated?.sha256,
              }),
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    },
    {
      name: 'workspace_edit',
      description:
        'Edit a text file in the workspace by replacing an exact string. ' +
        'The `oldString` must be an exact substring of the current file content. ' +
        'If you are unsure of the current content, use `workspace_read` first. ' +
        'Requires user approval unless auto-accept is enabled.',
      schema: WorkspaceEditSchema,
    },
  );
}
