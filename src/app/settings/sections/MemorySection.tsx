'use client';

import { cn } from '@/lib/utils';
import { Switch } from '@headlessui/react';
import Link from 'next/link';
import SettingsSection from '../components/SettingsSection';

export default function MemorySection({
  memoryEnabled,
  memoryRetrievalEnabled,
  memoryAutoDetectionEnabled,
  setMemoryEnabled,
  setMemoryRetrievalEnabled,
  setMemoryAutoDetectionEnabled,
}: {
  memoryEnabled: boolean;
  memoryRetrievalEnabled: boolean;
  memoryAutoDetectionEnabled: boolean;
  setMemoryEnabled: (val: boolean) => void;
  setMemoryRetrievalEnabled: (val: boolean) => void;
  setMemoryAutoDetectionEnabled: (val: boolean) => void;
}) {
  return (
    <SettingsSection title="Memory">
      <p className="text-xs text-fg/60">
        When enabled, YAAWC can remember facts about you across conversations to
        provide more personalized responses. Memories are stored separately from
        chat history and can be managed on the Memory page. Automatic detection
        uses additional LLM tokens.
      </p>
      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Memory</p>
            <p className="text-xs text-fg/60">
              Enable cross-conversation memory
            </p>
          </div>
          <Switch
            checked={memoryEnabled}
            onChange={(val: boolean) => {
              setMemoryEnabled(val);
              localStorage.setItem('memoryEnabled', String(val));
            }}
            className={cn(
              'group relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
              memoryEnabled ? 'bg-accent' : 'bg-surface-2',
            )}
          >
            <span className="sr-only">Enable memory</span>
            <span
              className={cn(
                'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                memoryEnabled ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </Switch>
        </div>

        {memoryEnabled && (
          <>
            <div className="flex items-center justify-between pl-4 border-l-2 border-surface-2">
              <div>
                <p className="text-sm font-medium">
                  Use saved memories in chats
                </p>
                <p className="text-xs text-fg/60">
                  Include relevant memories to personalize responses
                </p>
              </div>
              <Switch
                checked={memoryRetrievalEnabled}
                onChange={(val: boolean) => {
                  setMemoryRetrievalEnabled(val);
                  localStorage.setItem('memoryRetrievalEnabled', String(val));
                }}
                className={cn(
                  'group relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                  memoryRetrievalEnabled ? 'bg-accent' : 'bg-surface-2',
                )}
              >
                <span className="sr-only">Use saved memories in chats</span>
                <span
                  className={cn(
                    'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                    memoryRetrievalEnabled ? 'translate-x-5' : 'translate-x-0',
                  )}
                />
              </Switch>
            </div>

            <div className="flex items-center justify-between pl-4 border-l-2 border-surface-2">
              <div>
                <p className="text-sm font-medium">
                  Automatic memory detection
                </p>
                <p className="text-xs text-fg/60">
                  Analyze conversations to identify facts worth remembering.
                  Uses additional calls to your System Model.
                </p>
              </div>
              <Switch
                checked={memoryAutoDetectionEnabled}
                onChange={(val: boolean) => {
                  setMemoryAutoDetectionEnabled(val);
                  localStorage.setItem(
                    'memoryAutoDetectionEnabled',
                    String(val),
                  );
                }}
                className={cn(
                  'group relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                  memoryAutoDetectionEnabled ? 'bg-accent' : 'bg-surface-2',
                )}
              >
                <span className="sr-only">Automatic memory detection</span>
                <span
                  className={cn(
                    'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                    memoryAutoDetectionEnabled
                      ? 'translate-x-5'
                      : 'translate-x-0',
                  )}
                />
              </Switch>
            </div>
          </>
        )}

        <div className="flex items-center gap-3">
          <Link href="/memory" className="text-sm text-accent hover:underline">
            Manage memories →
          </Link>
        </div>

        <button
          onClick={() => {
            if (
              window.confirm(
                'Are you sure you want to delete all memories? This action cannot be undone.',
              )
            ) {
              fetch('/api/memories', { method: 'DELETE' }).then(() => {
                alert('All memories deleted.');
              });
            }
          }}
          className="text-sm text-red-500 hover:text-red-600 text-left"
        >
          Delete all memories
        </button>
      </div>
    </SettingsSection>
  );
}
