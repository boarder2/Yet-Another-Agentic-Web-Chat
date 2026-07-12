'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Info } from 'lucide-react';
import { ModelStats } from '../ChatWindow';
import TokenPill from '@/components/common/TokenPill';

interface ModelInfoButtonProps {
  modelStats: ModelStats | null;
}

/** Shared response-time / location / personalization / memories rows (present on both v1 and v2). */
const SharedRows: React.FC<{ modelStats: ModelStats }> = ({ modelStats }) => (
  <>
    {modelStats.responseTime && (
      <>
        <div className="opacity-70">Response time</div>
        <div className="font-medium">
          {(modelStats.responseTime / 1000).toFixed(2)}s
        </div>
      </>
    )}

    {modelStats.usedLocation !== undefined && (
      <>
        <div className="opacity-70">Used location</div>
        <div className="font-medium">
          {modelStats.usedLocation ? 'Yes' : 'No'}
        </div>
      </>
    )}

    {modelStats.usedPersonalization !== undefined && (
      <>
        <div className="opacity-70">Used personalization</div>
        <div className="font-medium">
          {modelStats.usedPersonalization ? 'Yes' : 'No'}
        </div>
      </>
    )}

    {modelStats.memoriesUsed !== undefined && modelStats.memoriesUsed > 0 && (
      <>
        <div className="opacity-70">Memories used</div>
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
          <div className="opacity-70">Model</div>
          <div className="font-medium truncate">Unknown</div>
        </>
      )}
      {modelStats.perModel.map((row) => {
        const showProvider = (nameCounts.get(row.model) ?? 0) > 1;
        const title = `${row.provider}/${row.model}`;
        return (
          <React.Fragment key={title}>
            <div className="opacity-70">Model</div>
            <div className="font-medium truncate" title={title}>
              {row.model}
              {showProvider && (
                <span className="opacity-60"> ·{row.provider}</span>
              )}
            </div>
            <div className="opacity-70">Tokens (est)</div>
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
          <div className="opacity-70">Model</div>
          <div className="font-medium truncate" title={modelName}>
            {modelName}
          </div>
        </>
      )}

      {/* Chat row */}
      {modelStats.modelNameChat && (
        <>
          <div className="opacity-70">Chat model</div>
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
          <div className="opacity-70">Chat tokens (est)</div>
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
          <div className="opacity-70">System model</div>
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
          <div className="opacity-70">System tokens (est)</div>
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
          <div className="opacity-70">Image gen model</div>
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
            <div className="opacity-70">Image gen tokens (est)</div>
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
          <div className="opacity-70">Tokens (est)</div>
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

const ModelInfoButton: React.FC<ModelInfoButtonProps> = ({ modelStats }) => {
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
      <button
        type="button"
        ref={buttonRef}
        className="p-1 ml-1 rounded-pill hover:bg-surface-2 transition duration-200"
        onClick={() => setShowPopover(!showPopover)}
        aria-label="Show model information"
      >
        <Info size={18} />
      </button>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelInfoButton;
