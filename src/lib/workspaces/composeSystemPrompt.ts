import { getWorkspace } from './service';
import { listLinkedPrompts } from './systemPromptLinks';

const WEB_FOCUS_MODES = new Set(['webSearch']);

export async function buildWorkspaceSystemPromptSuffix(opts: {
  workspaceId: string;
  focusMode: string;
}): Promise<string> {
  const ws = await getWorkspace(opts.workspaceId);
  if (!ws) return '';
  const sections: string[] = [];

  const linked = await listLinkedPrompts(opts.workspaceId);
  if (linked.length > 0) {
    sections.push(
      '## Workspace System Prompts\nBelow are specialized system prompts linked to this workspace. Adhere to these guidelines in your responses.',
    );
    for (const p of linked) {
      sections.push(`### ${p!.name}\n${p!.content}`);
    }
  }

  if (ws.instructions && ws.instructions.trim()) {
    sections.push(`## Workspace instructions\n${ws.instructions.trim()}`);
  }

  if (
    WEB_FOCUS_MODES.has(opts.focusMode) &&
    Array.isArray(ws.sourceUrls) &&
    ws.sourceUrls.length > 0
  ) {
    sections.push(
      [
        '## Preferred sources',
        'Prefer fetching from the following URLs first when relevant. Fetch before citing; do not cite without reading.',
        ...ws.sourceUrls.map((u, i) => `${i + 1}. ${u}`),
      ].join('\n'),
    );
  }

  sections.push(
    [
      '## Workspace tools',
      "You have access to `workspace_ls`, `workspace_grep`, `workspace_read`, `workspace_edit`, and `workspace_create_file` to inspect and modify this workspace's files. Prefer these over web search for project-local context.",
      '',
      '### workspace_edit',
      '`oldString` must be an exact substring of the current file content — the tool will fail with `no_match` if it does not match exactly. If you are unsure of the current content, call `workspace_read` first.',
      '- `replaceAll: false` (default): requires exactly one occurrence; fails with `not_unique` if there are multiple.',
      '- `replaceAll: true`: replaces every occurrence; fails if > 100 occurrences.',
      '- On `no_match`: re-read the file with `workspace_read` and retry with the correct snippet.',
      '',
      '### Error codes',
      '| Code | Recovery |',
      '|------|----------|',
      '| `file_not_found` | List files with `workspace_ls`. |',
      '| `file_exists` | Use `workspace_edit` instead of `workspace_create_file`. |',
      '| `not_editable` | This file type cannot be edited. |',
      '| `no_match` | Read the file with `workspace_read`; your snippet does not match the current contents. |',
      '| `not_unique` | Pass `replaceAll: true` or expand the snippet so it is unique. |',
      '| `too_many_replacements` | Narrow `oldString` or split into multiple edits. |',
      '| `diff_too_large` | Make a smaller, more targeted edit. |',
      '| `rejected_by_user` | The user declined; respect their decision or ask for guidance. |',
      '| `interactive_only` | Editing is only available in interactive sessions. |',
    ].join('\n'),
  );

  return sections.length > 0 ? '\n\n' + sections.join('\n\n') : '';
}
