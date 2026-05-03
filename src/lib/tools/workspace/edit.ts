import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import crypto from 'crypto';
import { isSoftStop } from '@/lib/utils/runControl';
import { getFileByName, replaceFile } from '@/lib/workspaces/files';
import { getText } from '@/lib/workspaces/extract';
import { hasNulByte, blobPath } from '@/lib/workspaces/paths';
import { waitForApprovalResponse } from '@/lib/workspaces/pendingEdits';
import { popCallbackRunId } from '@/lib/userQuestion/questionCorrelation';
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

      // 4. Load text
      const text = await getText(fileRow.sha256, fileRow.mime);
      if (text === null) {
        return err('not_editable', 'This file type is not editable.');
      }

      // 5. Apply edit
      const { oldString, newString, replaceAll } = input;

      // Count occurrences
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

      // 6. Diff-size cap (added + removed lines)
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

      // 7. Approval gate
      const ws = await getWorkspace(opts.workspaceId);
      const workspaceAutoAccept = ws?.autoAcceptFileEdits === 1;
      const fileAutoAccept = fileRow.autoAcceptEdits; // null | 0 | 1

      // Resolution: per-file wins over workspace
      const shouldPrompt =
        fileAutoAccept !== null ? fileAutoAccept === 0 : !workspaceAutoAccept;

      if (shouldPrompt) {
        const approvalId = crypto.randomUUID();
        const markupToolCallId = popCallbackRunId(input.file);

        opts.emitter.emit(
          'data',
          JSON.stringify({
            type: 'workspace_edit_approval_pending',
            data: {
              approvalId,
              toolCallId,
              markupToolCallId,
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
          }),
        );

        const response = await waitForApprovalResponse(
          approvalId,
          15 * 60 * 1000,
          opts.messageId,
        );

        opts.emitter.emit(
          'data',
          JSON.stringify({
            type: 'workspace_edit_approval_answered',
            data: {
              approvalId,
              toolCallId,
              decision: response.timedOut ? 'reject' : response.decision,
              freeformText: response.freeformText,
            },
          }),
        );

        if (response.timedOut) {
          return new Command({
            update: {
              messages: [
                new ToolMessage({
                  content: JSON.stringify({
                    error: 'rejected_by_user',
                    hint: 'User did not respond in time.',
                  }),
                  tool_call_id: toolCallId,
                }),
              ],
            },
          });
        }

        if (response.decision === 'accept_always') {
          await db
            .update(workspaceFiles)
            .set({ autoAcceptEdits: 1 })
            .where(eq(workspaceFiles.id, fileRow.id));
        }

        if (
          response.decision === 'reject' ||
          response.decision === 'always_prompt'
        ) {
          if (response.decision === 'always_prompt') {
            await db
              .update(workspaceFiles)
              .set({ autoAcceptEdits: 0 })
              .where(eq(workspaceFiles.id, fileRow.id));
          }
          const msg = response.freeformText
            ? `User rejected the edit: "${response.freeformText}"`
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

      // 8. Persist edit
      const newText = replaceAll
        ? text.split(oldString).join(newString)
        : text.replace(oldString, newString);

      const updated = await replaceFile({
        workspaceId: opts.workspaceId,
        fileId: fileRow.id,
        bytes: Buffer.from(newText, 'utf8'),
      });

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
