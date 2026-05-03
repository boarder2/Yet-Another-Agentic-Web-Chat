import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import crypto from 'crypto';
import { isSoftStop } from '@/lib/utils/runControl';
import { getFileByName, createFile } from '@/lib/workspaces/files';
import { hasNulByte, validateFilename } from '@/lib/workspaces/paths';
import { waitForApprovalResponse } from '@/lib/workspaces/pendingEdits';
import { popCallbackRunId } from '@/lib/userQuestion/questionCorrelation';
import { getWorkspace } from '@/lib/workspaces/service';
import db from '@/lib/db';
import { workspaceFiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const WorkspaceCreateFileSchema = z.object({
  file: z
    .string()
    .describe('Name of the file to create (must not already exist).'),
  content: z.string().describe('Text content for the new file.'),
  mime: z
    .string()
    .optional()
    .describe(
      'Optional MIME type (e.g. "text/markdown"). Inferred from extension if omitted.',
    ),
});

export function workspaceCreateFileTool(opts: {
  workspaceId: string;
  emitter: import('node:events').EventEmitter;
  interactiveSession: boolean;
  messageId: string;
}) {
  return tool(
    async (
      input: z.infer<typeof WorkspaceCreateFileSchema>,
      config?: RunnableConfig,
    ) => {
      const toolCallId =
        (config as unknown as { toolCall?: { id?: string } })?.toolCall?.id ??
        'workspace_create_file';

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

      // 1. Validate filename
      try {
        validateFilename(input.file);
      } catch (e) {
        return err('not_editable', `Invalid filename: ${String(e)}`);
      }

      // 2. NUL-byte sniff on proposed content
      const bytes = Buffer.from(input.content, 'utf8');
      if (hasNulByte(bytes)) {
        return err('not_editable', 'Content contains binary data.');
      }

      // 4. Diff-size cap: treat as all-additions
      const lineCount = input.content.split('\n').length;
      if (lineCount > 350) {
        return err(
          'diff_too_large',
          'Create a smaller file or split content across multiple `workspace_edit` calls after an initial create.',
        );
      }

      // 5. Existence check
      const existing = await getFileByName(opts.workspaceId, input.file).catch(
        () => null,
      );
      if (existing) {
        return err('file_exists', 'Use `workspace_edit` instead.');
      }

      // 6. Approval gate
      const ws = await getWorkspace(opts.workspaceId);
      const workspaceAutoAccept = ws?.autoAcceptFileEdits === 1;

      // For create, no fileRow yet — per-file override will be applied after creation
      const shouldPrompt = !workspaceAutoAccept;

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
              action: 'create',
              workspaceId: opts.workspaceId,
              file: input.file,
              content: input.content,
              workspaceAutoAccept,
              fileAutoAccept: null,
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

        if (
          response.decision === 'reject' ||
          response.decision === 'always_prompt'
        ) {
          const msg = response.freeformText
            ? `User rejected the file creation: "${response.freeformText}"`
            : 'User rejected the file creation.';
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

        // accept_always: we'll set the flag after creating the file below
        const shouldSetAutoAccept = response.decision === 'accept_always';

        // 7. Create file
        const row = await createFile({
          workspaceId: opts.workspaceId,
          name: input.file,
          mime: input.mime ?? null,
          bytes,
        });

        if (shouldSetAutoAccept) {
          await db
            .update(workspaceFiles)
            .set({ autoAcceptEdits: 1 })
            .where(eq(workspaceFiles.id, row.id));
        }

        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: JSON.stringify({
                  ok: true,
                  fileId: row.id,
                  newSha256: row.sha256,
                }),
                tool_call_id: toolCallId,
              }),
            ],
          },
        });
      }

      // No prompt needed
      const row = await createFile({
        workspaceId: opts.workspaceId,
        name: input.file,
        mime: input.mime ?? null,
        bytes,
      });

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: JSON.stringify({
                ok: true,
                fileId: row.id,
                newSha256: row.sha256,
              }),
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    },
    {
      name: 'workspace_create_file',
      description:
        'Create a new text file in the workspace. ' +
        'The file must not already exist (use `workspace_edit` to modify an existing file). ' +
        'Requires user approval unless auto-accept is enabled.',
      schema: WorkspaceCreateFileSchema,
    },
  );
}
