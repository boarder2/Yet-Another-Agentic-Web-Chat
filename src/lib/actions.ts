import { Message } from '@/components/ChatWindow';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';

export const getSuggestions = async (chatHisory: Message[]) => {
  const chatModel = localStorage.getItem('chatModel');
  const chatModelProvider = localStorage.getItem('chatModelProvider');

  const contextWindowSize = parseInt(
    localStorage.getItem('contextWindowSize') || String(DEFAULT_CONTEXT_WINDOW),
    10,
  );

  // Get selected system prompt IDs from localStorage
  const storedPromptIds = localStorage.getItem('selectedSystemPromptIds');
  let selectedSystemPromptIds: string[] = [];
  if (storedPromptIds) {
    try {
      selectedSystemPromptIds = JSON.parse(storedPromptIds);
    } catch (e) {
      console.error(
        'Failed to parse selectedSystemPromptIds from localStorage',
        e,
      );
    }
  }

  const hasPersistedChatModel =
    chatModelProvider !== null || chatModel !== null;
  const res = await fetch(`/api/suggestions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatHistory: chatHisory,
      chatModel: hasPersistedChatModel
        ? {
            provider: chatModelProvider ?? '',
            model: chatModel ?? '',
            contextWindowSize,
          }
        : undefined,
      selectedSystemPromptIds: selectedSystemPromptIds,
    }),
  });

  const data = (await res.json()) as { suggestions: string[] };

  return data.suggestions;
};
