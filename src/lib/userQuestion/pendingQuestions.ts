type UserQuestionResponse = {
  selectedOptions?: string[];
  freeformText?: string;
  skipped?: boolean;
  timedOut?: boolean;
};

type PendingQuestion = {
  resolve: (result: UserQuestionResponse) => void;
  timeout: NodeJS.Timeout;
  messageId?: string;
  createdAt: number;
};

const globalStore = globalThis as typeof globalThis & {
  __userQuestionPending?: Map<string, PendingQuestion>;
};

const pending =
  globalStore.__userQuestionPending ??
  (globalStore.__userQuestionPending = new Map<string, PendingQuestion>());

export function waitForUserResponse(
  questionId: string,
  timeoutMs: number = 900_000,
  messageId?: string,
): Promise<UserQuestionResponse> {
  return new Promise((resolve) => {
    if (pending.size > 100) {
      console.warn(
        `User question map has ${pending.size} live entries; check for orphaned questions.`,
      );
    }

    const timeout = setTimeout(() => {
      pending.delete(questionId);
      resolve({ timedOut: true });
    }, timeoutMs);

    pending.set(questionId, {
      resolve,
      timeout,
      messageId,
      createdAt: Date.now(),
    });
  });
}

export function resolveUserQuestion(
  questionId: string,
  response: Omit<UserQuestionResponse, 'timedOut'>,
): boolean {
  const entry = pending.get(questionId);
  if (!entry) return false;

  clearTimeout(entry.timeout);
  pending.delete(questionId);
  entry.resolve(response);
  return true;
}

/**
 * Auto-timeout all pending questions for a given messageId.
 * Called when the SSE stream disconnects (page refresh, tab close, etc.)
 * to prevent orphaned 15-minute waits.
 */
export function cancelQuestionsForMessage(messageId: string): void {
  for (const [id, entry] of pending) {
    if (entry.messageId === messageId) {
      clearTimeout(entry.timeout);
      pending.delete(id);
      entry.resolve({ timedOut: true });
    }
  }
}

export function cleanupAllQuestions(): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timeout);
    entry.resolve({ timedOut: true });
    pending.delete(id);
  }
}
