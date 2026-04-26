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
  for (const p of linked) {
    sections.push(`## ${p!.name}\n${p!.content}`);
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
    "## Workspace tools\nYou have access to `workspace_ls`, `workspace_grep`, and `workspace_read` to inspect this workspace's files. Prefer these over web search for project-local context.",
  );

  return sections.length > 0 ? '\n\n' + sections.join('\n\n') : '';
}
