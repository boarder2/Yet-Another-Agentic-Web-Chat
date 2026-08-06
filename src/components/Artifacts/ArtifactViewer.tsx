'use client';

import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  Eye,
  ExternalLink,
  LoaderCircle,
} from 'lucide-react';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { CodeBlock } from '@/components/CodeBlock';
import {
  artifactRawUrl,
  useArtifact,
  useArtifactSource,
} from '@/lib/hooks/api/useArtifacts';

/**
 * Artifact HTML is semi-trusted, so the frame withholds `allow-same-origin`:
 * the document lands on an opaque origin with no cookies, no storage, and no
 * credentialed access to this app's API. Popups are allowed so ordinary
 * `target="_blank"` links in a report still work, but they stay inside the
 * sandbox — `allow-popups-to-escape-sandbox` would hand an artifact an
 * unsandboxed same-origin window on request. Deliberately absent:
 * `allow-same-origin`, `allow-top-navigation`, `allow-forms`, `allow-modals`,
 * `allow-downloads`. This mirrors the serve route's `sandbox` directive, which
 * is what actually enforces the opaque origin however the content is loaded.
 */
export const ARTIFACT_SANDBOX = 'allow-scripts allow-popups';

interface ArtifactViewerProps {
  artifactId: string;
  /** Version to show; falls back to latest when absent or no longer present. */
  version?: number;
  onSelectVersion: (artifactId: string, version?: number) => void;
  /** Header start — a title, or the panel's artifact switcher. */
  title: React.ReactNode;
  /** Header end — close in the panel, delete on the page. */
  actions?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
}

/**
 * The document itself: version navigation, preview/source toggle, download and
 * open-in-new-tab, plus the sandboxed frame. Shared by the chat side panel and
 * the workspace document page, which differ only in their header ends.
 */
export default function ArtifactViewer({
  artifactId,
  version,
  onSelectVersion,
  title,
  actions,
  className,
  style,
  testId = 'artifact-viewer',
}: ArtifactViewerProps) {
  const { data: artifact, isLoading } = useArtifact(artifactId);
  const [view, setView] = useState<'preview' | 'source'>('preview');

  const versions = artifact?.versions ?? [];
  // A rewind can delete the version a card points at; fall back to latest
  // rather than rendering a 404 frame.
  const active =
    version !== undefined && versions.some((v) => v.version === version)
      ? version
      : artifact?.latestVersion;
  const index = versions.findIndex((v) => v.version === active);

  const { data: source, isLoading: sourceLoading } = useArtifactSource(
    artifactId,
    active,
    view === 'source',
  );

  const step = (delta: number) => {
    const next = versions[index + delta];
    if (next) onSelectVersion(artifactId, next.version);
  };

  return (
    <div
      className={className}
      style={style}
      data-testid={testId}
      data-artifact-id={artifactId}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-2 px-3 py-2">
        <div className="min-w-0 flex-1">{title}</div>

        {versions.length > 1 && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Previous version"
              disabled={index <= 0}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <Select
              aria-label="Version"
              data-testid="artifact-version"
              className="px-2 py-1 text-xs"
              value={String(active ?? '')}
              onChange={(e) =>
                onSelectVersion(artifactId, Number(e.target.value))
              }
              options={versions.map((v) => ({
                value: String(v.version),
                label: `v${v.version} of ${versions.length}`,
              }))}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label="Next version"
              disabled={index < 0 || index >= versions.length - 1}
              onClick={() => step(1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={view === 'source' ? 'secondary' : 'ghost'}
            data-testid="artifact-view-toggle"
            icon={view === 'preview' ? Code2 : Eye}
            onClick={() =>
              setView((v) => (v === 'preview' ? 'source' : 'preview'))
            }
          >
            {view === 'preview' ? 'Source' : 'Preview'}
          </Button>
          {/* Links, not buttons — they carry an href — so they borrow the
              ghost button's styling rather than restating it. */}
          <a
            href={artifactRawUrl(artifactId, active, true)}
            download
            aria-label="Download artifact"
            className={buttonClasses('ghost', 'sm')}
          >
            <Download size={16} />
          </a>
          <a
            href={artifactRawUrl(artifactId, active)}
            target="_blank"
            rel="noreferrer"
            aria-label="Open artifact in new tab"
            className={buttonClasses('ghost', 'sm')}
          >
            <ExternalLink size={16} />
          </a>
          {actions}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading || active === undefined ? (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle size={24} className="animate-spin text-accent" />
          </div>
        ) : view === 'preview' ? (
          <iframe
            // Remount on switch so the old document's JS state can't bleed through.
            key={`${artifactId}:${active}`}
            title={artifact?.title ?? 'Artifact'}
            data-testid="artifact-frame"
            src={artifactRawUrl(artifactId, active)}
            sandbox={ARTIFACT_SANDBOX}
            className="h-full w-full border-0 bg-bg"
          />
        ) : sourceLoading ? (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle size={24} className="animate-spin text-accent" />
          </div>
        ) : (
          <div data-testid="artifact-source" className="p-3">
            <CodeBlock className="lang-html">{source ?? ''}</CodeBlock>
          </div>
        )}
      </div>
    </div>
  );
}
