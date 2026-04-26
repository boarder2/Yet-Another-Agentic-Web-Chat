export interface ModelRef {
  provider: string;
  name: string;
  ollamaContextWindow?: number;
}

export interface WorkspaceCreate {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  instructions?: string;
  sourceUrls?: string[];
  chatModel: ModelRef;
  systemModel?: ModelRef | null;
  defaultFocusMode?: string | null;
  autoMemoryEnabled?: 0 | 1 | null;
}

export type WorkspaceUpdate = Partial<WorkspaceCreate>;
