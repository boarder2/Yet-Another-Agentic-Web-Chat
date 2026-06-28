/**
 * Pure string transforms for mutating `<SubagentExecution>` markup embedded in
 * an assistant message's content. Shared by the live streaming handler and the
 * reconnect/replay handler in ChatWindow so both paths nest subagent tool calls,
 * response tokens, and final status identically.
 *
 * Without a single source of truth these two paths drift: the reconnect path
 * previously ignored `subagent_data` entirely, so returning to a backgrounded
 * deep-research run rendered the subagent's tool calls outside the widget.
 */

type NestedToolEvent = {
  type?: string;
  data?: { content?: string; toolCallId?: string; error?: string };
};

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Insert a nested ToolCall into (or update its status within) the
 * SubagentExecution identified by `executionId`. Idempotent: a `tool_call_started`
 * whose toolCallId is already present is skipped, so replayed/seeded markup is
 * not duplicated.
 */
export function applySubagentNestedToolCall(
  content: string,
  executionId: string,
  nestedEvent: NestedToolEvent,
): string {
  if (!nestedEvent?.type) return content;

  if (nestedEvent.type === 'tool_call_started' && nestedEvent.data?.content) {
    const toolCallId = nestedEvent.data.toolCallId;
    if (toolCallId && content.includes(`toolCallId="${toolCallId}"`)) {
      return content;
    }
    const markup = nestedEvent.data.content;
    const subagentRegex = new RegExp(
      `(<SubagentExecution\\s+id="${executionId}"[^>]*>)(.*?)(</SubagentExecution>)`,
      'gs',
    );
    return content.replace(
      subagentRegex,
      (_match, openTag, inner, closeTag) =>
        `${openTag}${inner}${markup}\n${closeTag}`,
    );
  }

  if (
    nestedEvent.type === 'tool_call_success' &&
    nestedEvent.data?.toolCallId
  ) {
    const toolCallRegex = new RegExp(
      `<ToolCall([^>]*toolCallId="${nestedEvent.data.toolCallId}"[^>]*)>`,
      'g',
    );
    return content.replace(toolCallRegex, (_match, attrs) => {
      let updated = attrs.replace(/status="[^"]*"/, 'status="success"');
      if (!updated.includes('status=')) updated += ' status="success"';
      return `<ToolCall${updated}>`;
    });
  }

  if (nestedEvent.type === 'tool_call_error' && nestedEvent.data?.toolCallId) {
    const toolCallRegex = new RegExp(
      `<ToolCall([^>]*toolCallId="${nestedEvent.data.toolCallId}"[^>]*)>`,
      'g',
    );
    return content.replace(toolCallRegex, (_match, attrs) => {
      let updated = attrs.replace(/status="[^"]*"/, 'status="error"');
      if (!updated.includes('status=')) updated += ' status="error"';
      if (nestedEvent.data?.error) {
        updated += ` error="${escapeAttr(nestedEvent.data.error)}"`;
      }
      return `<ToolCall${updated}>`;
    });
  }

  return content;
}

/**
 * Accumulate a streamed subagent response token into the `responseText`
 * attribute of the SubagentExecution identified by `executionId`.
 */
export function applySubagentResponseToken(
  content: string,
  executionId: string,
  token: string,
): string {
  if (!token) return content;
  const subagentRegex = new RegExp(
    `<SubagentExecution\\s+id="${executionId}"([^>]*)>`,
    'g',
  );
  return content.replace(subagentRegex, (_match, attrs) => {
    const responseMatch = attrs.match(/responseText="([^"]*)"/);
    let existingText = '';
    if (responseMatch) {
      existingText = responseMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    }
    const escapedText = escapeAttr(existingText + token);
    let updatedAttrs = attrs.replace(
      /responseText="[^"]*"/,
      `responseText="${escapedText}"`,
    );
    if (!updatedAttrs.includes('responseText=')) {
      updatedAttrs += ` responseText="${escapedText}"`;
    }
    return `<SubagentExecution id="${executionId}"${updatedAttrs}>`;
  });
}

/**
 * Apply a terminal status (and optional summary/error) to the SubagentExecution
 * identified by `executionId`, preserving its nested tool-call markup.
 */
export function applySubagentStatus(
  content: string,
  executionId: string,
  status: 'success' | 'error',
  summary?: string,
  error?: string,
): string {
  const subagentRegex = new RegExp(
    `<SubagentExecution\\s+id="${executionId}"([^>]*)>(.*?)<\\/SubagentExecution>`,
    'gs',
  );
  return content.replace(subagentRegex, (_match, attrs, innerContent) => {
    let updatedAttrs = attrs
      .replace(/status="[^"]*"/, `status="${status}"`)
      .trim();
    if (!updatedAttrs.includes('status='))
      updatedAttrs += ` status="${status}"`;
    if (summary && status === 'success') {
      updatedAttrs += ` summary="${escapeAttr(summary)}"`;
    }
    if (error && status === 'error') {
      updatedAttrs += ` error="${escapeAttr(error)}"`;
    }
    return `<SubagentExecution ${updatedAttrs}>${innerContent}</SubagentExecution>`;
  });
}
