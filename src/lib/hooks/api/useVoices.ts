'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface Voice {
  id: string;
  name: string;
  language: string;
  gender: string;
}

interface VoicesResponse {
  voices: Voice[];
  defaultVoice: string;
}

export function useVoices() {
  return useQuery({
    queryKey: qk.voices,
    queryFn: () => apiFetch<VoicesResponse>('/api/tts'),
    staleTime: Infinity,
  });
}
