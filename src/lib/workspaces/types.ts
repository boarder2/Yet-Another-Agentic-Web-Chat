export interface WorkspaceModelOverride {
  chatProvider: string;
  chatModel: string;
  systemProvider: string;
  systemModel: string;
  imageCapable?: boolean;
  contextWindowSize?: number;
}

/** Shown (server error + composer banner) when a workspace's pinned model no
 * longer resolves against the live provider catalog. */
export const WORKSPACE_MODEL_UNAVAILABLE_MESSAGE =
  "This workspace's pinned model is no longer available. Update it in workspace settings.";

export interface WorkspaceCreate {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  instructions?: string;
  sourceUrls?: string[];
  autoMemoryEnabled?: 0 | 1 | null;
  autoAcceptFileEdits?: 0 | 1;
  modelOverride?: WorkspaceModelOverride | null;
}

export type WorkspaceUpdate = Partial<WorkspaceCreate>;
