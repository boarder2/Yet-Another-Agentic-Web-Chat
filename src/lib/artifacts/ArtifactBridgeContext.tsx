'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

type OpenFn = (artifactId: string, version?: number) => void;
type InsertFn = (artifactId: string, title: string) => void;

interface ArtifactBridgeValue {
  /** Called by the chat's panel on mount; returns the teardown. */
  registerOpen: (fn: OpenFn) => () => void;
  /** Called by the composer on mount; returns the teardown. */
  registerInsert: (fn: InsertFn) => () => void;
  openArtifact: OpenFn | null;
  insertMention: InsertFn | null;
}

const ArtifactBridgeContext = createContext<ArtifactBridgeValue | null>(null);

/**
 * Lets the workspace sidebar drive the chat rendered beside it. The two are
 * siblings under the workspace layout, not parent and child, so the chat's panel
 * and composer register here and the sidebar calls them.
 *
 * The handlers are state rather than refs so the sidebar re-renders when a chat
 * mounts, and their presence doubles as a surface test: on the workspace detail
 * page nothing registers, so the sidebar opens the document's own page instead.
 */
export function ArtifactBridgeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [openArtifact, setOpen] = useState<OpenFn | null>(null);
  const [insertMention, setInsert] = useState<InsertFn | null>(null);

  // Setter form everywhere: React would otherwise call a bare function argument
  // as a state updater rather than storing it.
  const registerOpen = useCallback((fn: OpenFn) => {
    setOpen(() => fn);
    return () => setOpen((cur: OpenFn | null) => (cur === fn ? null : cur));
  }, []);
  const registerInsert = useCallback((fn: InsertFn) => {
    setInsert(() => fn);
    return () => setInsert((cur: InsertFn | null) => (cur === fn ? null : cur));
  }, []);

  const value = useMemo(
    () => ({ registerOpen, registerInsert, openArtifact, insertMention }),
    [registerOpen, registerInsert, openArtifact, insertMention],
  );

  return (
    <ArtifactBridgeContext.Provider value={value}>
      {children}
    </ArtifactBridgeContext.Provider>
  );
}

/** Null outside a workspace layout, where there is no sidebar to bridge to. */
export const useArtifactBridge = () => useContext(ArtifactBridgeContext);
