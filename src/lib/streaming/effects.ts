/**
 * Effects the stream reducer emits as data. The reducer stays pure; ChatWindow's
 * interpreter performs the actual side effects (toasts, query invalidation,
 * loading/scroll, suggestion fetches, skill refreshes).
 */
export type StreamEffect =
  | { kind: 'toastError'; message: string }
  | { kind: 'setLoading'; value: boolean }
  | { kind: 'bumpScroll' }
  | { kind: 'invalidateActiveRuns' }
  | { kind: 'invalidateWorkspace'; workspaceId: string }
  | { kind: 'fetchSuggestions'; messageId: string }
  | { kind: 'refreshSkills' }
  | { kind: 'setChatTitle'; chatId: string; title: string }
  | { kind: 'openArtifact'; artifactId: string; version: number }
  | { kind: 'invalidateArtifacts'; chatId: string };
