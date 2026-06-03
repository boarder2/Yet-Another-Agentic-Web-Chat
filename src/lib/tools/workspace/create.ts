import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { ToolMessage } from '@langchain/core/messages';
import { Command, interrupt } from '@langchain/langgraph';
import { isSoftStop } from '@/lib/utils/runControl';
import { getFileByName, createFile } from '@/lib/workspaces/files';
import { hasNulByte, validateFilename } from '@/lib/workspaces/paths';
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

      // 2. NUL-byte sniff
      const bytes = Buffer.from(input.content, 'utf8');
      if (hasNulByte(bytes)) {
        return err('not_editable', 'Content contains binary data.');
      }

      // 3. Line cap
      const lineCount = input.content.split('\n').length;
      if (lineCount > 350) {
        return err(
          'diff_too_large',
          'Create a smaller file or split content across multiple `workspace_edit` calls after an initial create.',
        );
      }

      // 4. Existence check
      const existing = await getFileByName(opts.workspaceId, input.file).catch(
        () => null,
      );
      if (existing) {
        return err('file_exists', 'Use `workspace_edit` instead.');
      }

      // 5. Approval gate
      const ws = await getWorkspace(opts.workspaceId);
      const workspaceAutoAccept = ws?.autoAcceptFileEdits === 1;
      const shouldPrompt = !workspaceAutoAccept;

      if (shouldPrompt) {
        const snapshot = { workspaceAutoAccept };

        const response: unknown = interrupt({
          kind: 'workspace_create',
          toolCallId,
          markupKey: input.file,
          payload: {
            action: 'create',
            workspaceId: opts.workspaceId,
            file: input.file,
            content: input.content,
            workspaceAutoAccept,
            fileAutoAccept: null,
            createdAt: Date.now(),
          },
          snapshot,
        });

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

        // Stale discriminator: a file with this name now exists (created while
        // awaiting approval). Surface it so the agent inspects + edits instead.
        if (response && (response as Record<string, unknown>).__stale) {
          const reason = (response as { reason?: string }).reason;
          return err(
            'stale_state',
            `${reason ?? 'A file with this name now exists.'} Use \`workspace_read\` to inspect it, then \`workspace_edit\` if a change is still needed.`,
          );
        }

        const createResponse = response as {
          decision: 'accept' | 'accept_always' | 'reject' | 'always_prompt';
          freeformText?: string;
        };

        if (
          createResponse.decision === 'reject' ||
          createResponse.decision === 'always_prompt'
        ) {
          const msg = createResponse.freeformText
            ? `User rejected the file creation: "${createResponse.freeformText}"`
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

        const shouldSetAutoAccept = createResponse.decision === 'accept_always';

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

        opts.emitter.emit(
          'data',
          JSON.stringify({
            type: 'workspace_file_changed',
            data: {
              workspaceId: opts.workspaceId,
              file: input.file,
              action: 'create',
            },
          }),
        );

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

      opts.emitter.emit(
        'data',
        JSON.stringify({
          type: 'workspace_file_changed',
          data: {
            workspaceId: opts.workspaceId,
            file: input.file,
            action: 'create',
          },
        }),
      );

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
