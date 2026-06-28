'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface Tool {
  name: string;
  description?: string;
}

export function useTools() {
  return useQuery({
    queryKey: qk.tools,
    queryFn: () => apiFetch<Tool[]>('/api/tools'),
    select: (d) => (Array.isArray(d) ? d : []),
  });
}
