export type Skill = {
  source: 'system' | 'user';
  id?: string;
  name: string;
  description: string;
  content: string;
  workspaceId?: string | null;
  disableModelInvocation: boolean;
};
