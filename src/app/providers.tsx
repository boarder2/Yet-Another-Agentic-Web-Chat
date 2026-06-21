'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  hydrateSettingsFromDb,
  installSettingsPersistence,
  resyncSettingsFromDb,
} from '@/lib/settings/persist';
import TitleBadge from '@/components/TitleBadge';

/**
 * Installs the localStorage→DB persistence interceptor and hydrates the local
 * cache from the database once on mount. Also re-pulls the DB on every client
 * navigation so a page always reflects changes made on another device — the
 * fetch is background/non-blocking and throttled, so it never delays navigation
 * and collapses to the most recent sync when one just ran. Renders nothing.
 */
function SettingsHydrator() {
  const pathname = usePathname();

  useEffect(() => {
    installSettingsPersistence();
    void hydrateSettingsFromDb();
  }, []);

  // Runs on mount (no-op until hydration completes) and on each route change.
  useEffect(() => {
    void resyncSettingsFromDb();
  }, [pathname]);

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 3,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsHydrator />
      <TitleBadge />
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
