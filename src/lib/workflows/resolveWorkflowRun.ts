import type { workflows } from '@/lib/db/schema';
import {
  parseWorkflowTemplate,
  substitute,
  missingRequired,
  type FieldDef,
} from './template';
import { parseModelReference } from '@/lib/providers/resolveModels';

export type Workflow = typeof workflows.$inferSelect;

export interface ResolvedWorkflowRun {
  composedQuery: string;
  focusMode: string;
  chatModel: Workflow['chatModel'];
  systemModel: Workflow['systemModel'];
  selectedSystemPromptIds: string[];
  selectedMethodologyId: string | null;
  fields: FieldDef[];
}

export class RequiredInputsError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing required inputs: ${missing.join(', ')}`);
    this.name = 'RequiredInputsError';
  }
}

/**
 * Compose everything needed to start a run from a workflow + a fill-set. Shared
 * by both run paths (§7.3): the manual path passes the request's form values and
 * request time, the scheduled path passes the schedule's saved fill-set and fire
 * time. The clock resolves the built-in `@today`/`@now` tokens deterministically.
 *
 * Authoritative required-field gate (Decision 15): throws `RequiredInputsError`
 * before substitution when any required input is missing.
 */
export function resolveWorkflowRun(
  workflow: Workflow,
  values: Record<string, string | string[]>,
  now: Date = new Date(),
): ResolvedWorkflowRun {
  const { fields } = parseWorkflowTemplate(workflow.prompt);
  const chatModel = parseModelReference(workflow.chatModel);
  const systemModel =
    workflow.systemModel == null
      ? null
      : parseModelReference(workflow.systemModel);
  const missing = missingRequired(fields, values);
  if (missing.length > 0) throw new RequiredInputsError(missing);

  return {
    composedQuery: substitute(workflow.prompt, fields, values, now),
    focusMode: workflow.focusMode,
    chatModel,
    systemModel,
    selectedSystemPromptIds: workflow.selectedSystemPromptIds ?? [],
    selectedMethodologyId: workflow.selectedMethodologyId ?? null,
    fields,
  };
}
