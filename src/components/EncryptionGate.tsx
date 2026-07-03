'use client';

import { ShieldAlert } from 'lucide-react';
import { useConfig } from '@/lib/hooks/api/useConfig';

/**
 * App-wide gate on `GET /api/config`'s `encryptionConfigured` flag. Wraps the
 * entire app (see `layout.tsx`) so nothing — chat, settings, sidebar — renders
 * until a `SECURITY.ENCRYPTION_PASSPHRASE` is set in config.toml or an
 * `ENCRYPTION_PASSPHRASE` env var. The passphrase itself is never sent to the
 * client; only this boolean is.
 */
export default function EncryptionGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data, isLoading } = useConfig();

  // Avoid flashing the block screen while the initial fetch is in flight.
  if (isLoading) return null;

  const encryptionConfigured = (data as { encryptionConfigured?: boolean })
    ?.encryptionConfigured;

  if (encryptionConfigured === false) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-bg p-6">
        <div className="w-full max-w-md space-y-4 rounded-surface border border-danger bg-surface p-6 text-center shadow-resting">
          <ShieldAlert className="mx-auto text-danger" size={32} />
          <h1 className="text-lg font-semibold text-fg">
            Encryption not configured
          </h1>
          <p className="text-sm text-fg/70">
            YAAWC encrypts stored API keys and MCP credentials at rest and
            requires a passphrase to do so. Add one to{' '}
            <code className="font-mono">config.toml</code>, or set the{' '}
            <code className="font-mono">ENCRYPTION_PASSPHRASE</code> environment
            variable, then restart the server to continue.
          </p>
          <pre className="overflow-x-auto rounded-control bg-surface-2 p-3 text-left font-mono text-xs text-fg">
            {'[SECURITY]\nENCRYPTION_PASSPHRASE = "your-passphrase-here"'}
          </pre>
          <p className="text-xs text-fg/50">or</p>
          <pre className="overflow-x-auto rounded-control bg-surface-2 p-3 text-left font-mono text-xs text-fg">
            {'ENCRYPTION_PASSPHRASE=your-passphrase-here'}
          </pre>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
