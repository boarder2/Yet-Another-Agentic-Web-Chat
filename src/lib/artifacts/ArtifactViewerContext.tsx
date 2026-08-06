'use client';

import { createContext, useContext } from 'react';

interface ArtifactViewerContextValue {
  /** Open the viewer panel on an artifact, at `version` when given (latest otherwise). */
  openArtifact: (artifactId: string, version?: number) => void;
}

/**
 * Lets an in-message artifact card reopen the viewer without threading a
 * callback through every markdown override. The default no-ops so cards render
 * harmlessly outside a chat (dashboard widgets, exported markdown).
 */
export const ArtifactViewerContext = createContext<ArtifactViewerContextValue>({
  openArtifact: () => {},
});

export const useArtifactViewer = () => useContext(ArtifactViewerContext);
