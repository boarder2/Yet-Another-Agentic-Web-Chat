export interface WorkspaceCreate {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  instructions?: string;
  sourceUrls?: string[];
  autoMemoryEnabled?: 0 | 1 | null;
  autoAcceptFileEdits?: 0 | 1;
}

export type WorkspaceUpdate = Partial<WorkspaceCreate>;
