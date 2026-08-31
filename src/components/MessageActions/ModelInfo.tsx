'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Info } from 'lucide-react';
import { ModelStats } from '../ChatWindow';
import TokenPill from '@/components/common/TokenPill';
import { IconButton } from '@/components/ui/IconButton';
import type { AgentModelConfigAudit } from '@/lib/search/agentRunConfig';
import { REASONING_EFFORT_LABELS } from '@/lib/providers/reasoningEffort';

interface ModelInfoButtonProps {
  modelStats: ModelStats | null;
  /** Effective role/executor settings retained in completed assistant metadata. */
  modelConfig?: AgentModelConfigAudit | null;
}

/** Shared response-time / location / personalization / memories rows (present on both v1 and v2). */
const SharedRows: React.FC<{ modelStats: ModelStats }> = ({ modelStats }) => (
  <>
    {modelStats.responseTime && (
      <>
        <div className="text-fg-subtle">Response time</div>
        <div className="font-medium">
          {(modelStats.responseTime / 1000).toFixed(2)}s
        </div>
      </>
    )}

    {modelStats.usedLocation !== undefined && (
      <>
        <div className="text-fg-subtle">Used location</div>
        <div className="font-medium">
          {modelStats.usedLocation ? 'Yes' : 'No'}
        </div>
      </>
    )}

    {modelStats.usedPersonalization !== undefined && (
      <>
        <div className="text-fg-subtle">Used personalization</div>
        <div className="font-medium">
          {modelStats.usedPersonalization ? 'Yes' : 'No'}
        </div>
      </>
    )}

    {modelStats.memoriesUsed !== undefined && modelStats.memoriesUsed > 0 && (
      <>
        <div className="text-fg-subtle">Memories used</div>
        <div className="font-medium">{modelStats.memoriesUsed}</div>
      </>
    )}
  </>
);

const ModelInfoRowsV2: React.FC<{
  modelStats: Extract<ModelStats, { version: 2 }>;
}> = ({ modelStats }) => {
  // Provider suffix only shown when ≥2 rows share a model name.
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of modelStats.perModel) {
      counts.set(row.model, (counts.get(row.model) ?? 0) + 1);
    }
    return counts;
  }, [modelStats.perModel]);

  return (
    <>
      {modelStats.perModel.length === 0 && (
        <>
          <div className="text-fg-subtle">Model</div>
          <div className="font-medium truncate">Unknown</div>
        </>
      )}
      {modelStats.perModel.map((row) => {
        const showProvider = (nameCounts.get(row.model) ?? 0) > 1;
        const title = `${row.provider}/${row.model}`;
        return (
          <React.Fragment key={title}>
            <div className="text-fg-subtle">Model</div>
            <div className="font-medium truncate" title={title}>
              {row.model}
              {showProvider && (
                <span className="text-fg-subtle"> ·{row.provider}</span>
              )}
            </div>
            <div className="text-fg-subtle">Tokens (est)</div>
            <div className="flex flex-wrap gap-2">
              <TokenPill label="In" value={row.usage.input_tokens} />
              <TokenPill label="Out" value={row.usage.output_tokens} />
              <TokenPill
                label="Total"
                value={row.usage.total_tokens}
                highlight
              />
            </div>
          </React.Fragment>
        );
      })}
      <SharedRows modelStats={modelStats} />
    </>
  );
};

const ModelInfoRowsV1: React.FC<{
  modelStats: Exclude<ModelStats, { version: 2 }>;
}> = ({ modelStats }) => {
  const modelName =
    modelStats.modelName || modelStats.modelNameChat || 'Unknown';

  return (
    <>
      {/* Legacy single-name fallback */}
      {!modelStats.modelNameChat && modelName && (
        <>
          <div className="text-fg-subtle">Model</div>
          <div className="font-medium truncate" title={modelName}>
            {modelName}
          </div>
        </>
      )}

      {/* Chat row */}
      {modelStats.modelNameChat && (
        <>
          <div className="text-fg-subtle">Chat model</div>
          <div
            className="font-medium truncate"
            title={modelStats.modelNameChat}
          >
            {modelStats.modelNameChat}
          </div>
        </>
      )}
      {modelStats.usageChat && (
        <>
          <div className="text-fg-subtle">Chat tokens (est)</div>
          <div className="flex flex-wrap gap-2">
            <TokenPill label="In" value={modelStats.usageChat.input_tokens} />
            <TokenPill label="Out" value={modelStats.usageChat.output_tokens} />
            <TokenPill
              label="Total"
              value={modelStats.usageChat.total_tokens}
              highlight
            />
          </div>
        </>
      )}

      {/* System row */}
      {modelStats.modelNameSystem && (
        <>
          <div className="text-fg-subtle">System model</div>
          <div
            className="font-medium truncate"
            title={modelStats.modelNameSystem}
          >
            {modelStats.modelNameSystem}
          </div>
        </>
      )}
      {modelStats.usageSystem && (
        <>
          <div className="text-fg-subtle">System tokens (est)</div>
          <div className="flex flex-wrap gap-2">
            <TokenPill label="In" value={modelStats.usageSystem.input_tokens} />
            <TokenPill
              label="Out"
              value={modelStats.usageSystem.output_tokens}
            />
            <TokenPill
              label="Total"
              value={modelStats.usageSystem.total_tokens}
              highlight
            />
          </div>
        </>
      )}

      {/* Image generation row */}
      {modelStats.usageImageGen && (
        <>
          <div className="text-fg-subtle">Image gen model</div>
          <div
            className="font-medium truncate"
            title={
              modelStats.usageImageGen.modelName || 'Image generation model'
            }
          >
            {modelStats.usageImageGen.modelName || 'Image generation model'}
          </div>
        </>
      )}
      {modelStats.usageImageGen &&
        (modelStats.usageImageGen.input_tokens > 0 ||
          modelStats.usageImageGen.output_tokens > 0) && (
          <>
            <div className="text-fg-subtle">Image gen tokens (est)</div>
            <div className="flex flex-wrap gap-2">
              <TokenPill
                label="In"
                value={modelStats.usageImageGen.input_tokens}
              />
              <TokenPill
                label="Out"
                value={modelStats.usageImageGen.output_tokens}
              />
              <TokenPill
                label="Total"
                value={modelStats.usageImageGen.total_tokens}
                highlight
              />
            </div>
          </>
        )}

      {/* Legacy single-usage fallback */}
      {!modelStats.usageChat && !modelStats.usageSystem && modelStats.usage && (
        <>
          <div className="text-fg-subtle">Tokens (est)</div>
          <div className="flex flex-wrap gap-2">
            <TokenPill label="In" value={modelStats.usage.input_tokens} />
            <TokenPill label="Out" value={modelStats.usage.output_tokens} />
            <TokenPill
              label="Total"
              value={modelStats.usage.total_tokens}
              highlight
            />
          </div>
        </>
      )}

      <SharedRows modelStats={modelStats} />
    </>
  );
};

const ModelConfigRows: React.FC<{
  modelConfig: AgentModelConfigAudit;
}> = ({ modelConfig }) => {
  const effortLabel = (effort?: keyof typeof REASONING_EFFORT_LABELS) =>
    effort ? REASONING_EFFORT_LABELS[effort] : 'Provider default';
  const modelLabel = (ref: { provider: string; name: string }) =>
    `${ref.name} · ${ref.provider}`;

  return (
    <>
      <div className="col-span-2 border-t border-surface-2 pt-2 font-medium text-fg">
        Effective model settings
      </div>
      <div className="text-fg-subtle">Chat effort</div>
      <div
        className="font-medium truncate"
        title={modelLabel(modelConfig.chat)}
      >
        {modelLabel(modelConfig.chat)} ·{' '}
        {effortLabel(modelConfig.chat.reasoningEffort)}
      </div>
      <div className="text-fg-subtle">System effort</div>
      <div
        className="font-medium truncate"
        title={modelLabel(modelConfig.system)}
      >
        {modelLabel(modelConfig.system)} ·{' '}
        {effortLabel(modelConfig.system.reasoningEffort)}
      </div>
      {modelConfig.panel?.executors.map((executor, index) => (
        <React.Fragment key={`${executor.provider}/${executor.name}/${index}`}>
          <div className="text-fg-subtle">Panel executor {index + 1}</div>
          <div className="font-medium truncate" title={modelLabel(executor)}>
            {modelLabel(executor)} · {effortLabel(executor.reasoningEffort)}
          </div>
        </React.Fragment>
      ))}
    </>
  );
};

const ModelInfoButton: React.FC<ModelInfoButtonProps> = ({
  modelStats,
  modelConfig,
}) => {
  const [showPopover, setShowPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowPopover(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="relative">
      <IconButton
        ref={buttonRef}
        icon={Info}
        label="Show model information"
        onClick={() => setShowPopover(!showPopover)}
        className="ml-1 rounded-pill p-1"
      />
      {showPopover && (
        <div
          ref={popoverRef}
          className="absolute z-10 left-8 bottom-0 w-96 rounded-control shadow-raised border border-surface-2 bg-surface"
        >
          <div className="py-2 px-3">
            <h4 className="text-sm font-medium mb-2">Model Information</h4>
            {/* Table-like grid */}
            <div className="text-xs grid grid-cols-[auto,1fr] gap-x-3 gap-y-2 items-center">
              {modelStats &&
                (modelStats.version === 2 ? (
                  <ModelInfoRowsV2 modelStats={modelStats} />
                ) : (
                  <ModelInfoRowsV1 modelStats={modelStats} />
                ))}
              {modelConfig && <ModelConfigRows modelConfig={modelConfig} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelInfoButton;
