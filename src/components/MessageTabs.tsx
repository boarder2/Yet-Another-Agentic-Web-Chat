'use client';

import { getSuggestions } from '@/lib/actions';
import { cn } from '@/lib/utils';
import {
  BookCopy,
  ImagesIcon,
  Layers3,
  Plus,
  Sparkles,
  StopCircle,
  VideoIcon,
  Volume2,
  LoaderCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSpeech } from 'react-text-to-speech';
import { Message } from './ChatWindow';
import MarkdownRenderer from './MarkdownRenderer';
import Copy from './MessageActions/Copy';
import ModelInfoButton from './MessageActions/ModelInfo';
import Rewrite from './MessageActions/Rewrite';
import MessageSources from './MessageSources';
import SearchImages from './SearchImages';
import SearchVideos from './SearchVideos';
import MessageBoxLoading from './MessageBoxLoading';
import { Document } from '@langchain/core/documents';

type PanelType = 'sources' | 'images' | 'videos';

interface SearchTabsProps {
  chatHistory: Message[];
  query: string;
  messageId: string;
  message: Message;
  isLast: boolean;
  loading: boolean;
  rewrite: (messageId: string) => void;
  sendMessage: (
    message: string,
    options?: {
      messageId?: string;
      rewriteIndex?: number;
      suggestions?: string[];
    },
  ) => void;
  onThinkBoxToggle: (
    messageId: string,
    thinkBoxId: string,
    expanded: boolean,
  ) => void;
  analysisProgress?: {
    message: string;
    current: number;
    total: number;
    subMessage?: string;
  } | null;
  modelStats?: {
    usage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
    usageChat?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
    usageSystem?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
  } | null;
  gatheringSources?: Array<{
    searchQuery: string;
    sources: Document[];
  }>;
  actionMessageId?: string;
  isPrivateSession?: boolean;
  searchCapabilities?: {
    web: boolean;
    images: boolean;
    videos: boolean;
    autocomplete: boolean;
  };
}

const MessageTabs = ({
  chatHistory,
  query,
  messageId,
  message,
  isLast,
  loading,
  rewrite,
  sendMessage,
  onThinkBoxToggle,
  analysisProgress,
  modelStats,
  gatheringSources,
  actionMessageId,
  isPrivateSession,
  searchCapabilities,
}: SearchTabsProps) => {
  const imagesAvailable = searchCapabilities?.images ?? false;
  const videosAvailable = searchCapabilities?.videos ?? false;
  const [openPanel, setOpenPanel] = useState<PanelType | null>(null);
  const [imageCount, setImageCount] = useState(0);
  const [videoCount, setVideoCount] = useState(0);
  const [imagesOpenedOnce, setImagesOpenedOnce] = useState(false);
  const [videosOpenedOnce, setVideosOpenedOnce] = useState(false);

  const togglePanel = (panel: PanelType) => {
    setOpenPanel((cur) => (cur === panel ? null : panel));
    if (panel === 'images') setImagesOpenedOnce(true);
    if (panel === 'videos') setVideosOpenedOnce(true);
  };
  const [parsedMessage, setParsedMessage] = useState(message.content);
  const [speechMessage, setSpeechMessage] = useState(message.content);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const { speechStatus, start, stop } = useSpeech({ text: speechMessage });

  // Callback functions to update counts
  const updateImageCount = (count: number) => {
    setImageCount(count);
  };

  const updateVideoCount = (count: number) => {
    setVideoCount(count);
  };

  // Load suggestions handling
  const handleLoadSuggestions = useCallback(async () => {
    if (
      loadingSuggestions ||
      (message?.suggestions && message.suggestions.length > 0)
    )
      return;

    setLoadingSuggestions(true);
    try {
      const suggestions = await getSuggestions([...chatHistory, message]);
      // Update the message.suggestions property through parent component
      sendMessage('', { messageId: message.messageId, suggestions });
    } catch (error) {
      console.error('Error loading suggestions:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [loadingSuggestions, message, chatHistory, sendMessage]);

  // Process message content
  useEffect(() => {
    const regex = /\[(\d+)\]/g;
    let processedMessage = message.content;

    if (message.role === 'assistant' && processedMessage.includes('<think>')) {
      const openThinkTag = processedMessage.match(/<think>/g)?.length || 0;
      const closeThinkTag = processedMessage.match(/<\/think>/g)?.length || 0;

      if (openThinkTag > closeThinkTag) {
        processedMessage += '</think> <a> </a>'; // The extra <a> </a> is to prevent the think component from looking bad
      }
    }

    if (
      message.role === 'assistant' &&
      message?.sources &&
      message.sources.length > 0
    ) {
      setParsedMessage(
        processedMessage.replace(regex, (_, capturedContent: string) => {
          const numbers = capturedContent
            .split(',')
            .map((numStr) => numStr.trim());

          const linksHtml = numbers
            .map((numStr) => {
              const number = parseInt(numStr);

              if (isNaN(number) || number <= 0) {
                return `[${numStr}]`;
              }

              const source = message.sources?.[number - 1];
              const url = source?.metadata?.url;

              if (url) {
                return `<a href="${url}" target="_blank" data-citation="${number}" className="bg-surface px-1 rounded-control ml-1 no-underline text-xs relative hover:bg-surface-2 transition-colors duration-200">${numStr}</a>`;
              } else {
                return `[${numStr}]`;
              }
            })
            .join('');

          return linksHtml;
        }),
      );
      setSpeechMessage(message.content.replace(regex, ''));
      return;
    }

    setSpeechMessage(message.content.replace(regex, ''));
    setParsedMessage(processedMessage);
  }, [message.content, message.sources, message.role]);

  // Auto-suggest effect (similar to MessageBox)
  useEffect(() => {
    const autoSuggestions = localStorage.getItem('autoSuggestions');
    if (
      isLast &&
      message.role === 'assistant' &&
      !loading &&
      autoSuggestions === 'true'
    ) {
      handleLoadSuggestions();
    }
  }, [isLast, loading, message.role, handleLoadSuggestions]);

  const hasSources = !!message.sources && message.sources.length > 0;

  const panelIconBtnClass = (active: boolean) =>
    cn(
      'flex items-center gap-1.5 px-2 py-1.5 rounded-surface text-sm transition duration-200',
      active
        ? 'bg-surface-2 text-accent'
        : 'opacity-70 hover:bg-surface-2 hover:opacity-100',
    );

  return (
    <div className="flex flex-col w-full">
      <div className="transition-all duration-200 ease-in-out">
        <div className="flex flex-col space-y-4 animate-fadeIn">
          {loading && isLast && (
            <MessageBoxLoading
              progress={analysisProgress || null}
              modelStats={modelStats}
              actionMessageId={actionMessageId}
              gatheringSources={gatheringSources}
            />
          )}
          <MarkdownRenderer
            content={parsedMessage}
            className="px-4"
            messageId={message.messageId}
            expandedThinkBoxes={message.expandedThinkBoxes}
            onThinkBoxToggle={onThinkBoxToggle}
            showThinking={true}
            sources={message.sources}
          />
          {loading && isLast ? null : (
            <div className="flex flex-row items-center justify-between w-full px-4 py-4">
              <div className="flex flex-row items-center space-x-1">
                <Rewrite rewrite={rewrite} messageId={message.messageId} />
                {message.modelStats && (
                  <ModelInfoButton modelStats={message.modelStats} />
                )}
                {hasSources && (
                  <button
                    onClick={() => togglePanel('sources')}
                    className={panelIconBtnClass(openPanel === 'sources')}
                    title="Sources"
                    aria-pressed={openPanel === 'sources'}
                  >
                    <BookCopy size={18} />
                    <span className="text-xs">{message.sources!.length}</span>
                  </button>
                )}
                {imagesAvailable && (
                  <button
                    onClick={() => togglePanel('images')}
                    className={panelIconBtnClass(openPanel === 'images')}
                    title="Images"
                    aria-pressed={openPanel === 'images'}
                  >
                    <ImagesIcon size={18} />
                    {imageCount > 0 && (
                      <span className="text-xs">{imageCount}</span>
                    )}
                  </button>
                )}
                {videosAvailable && (
                  <button
                    onClick={() => togglePanel('videos')}
                    className={panelIconBtnClass(openPanel === 'videos')}
                    title="Videos"
                    aria-pressed={openPanel === 'videos'}
                  >
                    <VideoIcon size={18} />
                    {videoCount > 0 && (
                      <span className="text-xs">{videoCount}</span>
                    )}
                  </button>
                )}
              </div>
              <div className="flex flex-row items-center space-x-1">
                <Copy initialMessage={message.content} message={message} />
                <button
                  onClick={() => {
                    if (speechStatus === 'started') {
                      stop();
                    } else {
                      start();
                    }
                  }}
                  className="p-2 opacity-70 rounded-floating hover:bg-surface-2 transition duration-200"
                >
                  {speechStatus === 'started' ? (
                    <StopCircle size={18} />
                  ) : (
                    <Volume2 size={18} />
                  )}
                </button>
              </div>
            </div>
          )}
          {loading && isLast && (
            <div className="pl-3 flex items-center justify-start">
              <div className="flex space-x-1">
                <div className="w-1.5 h-1.5 bg-fg/40 rounded-pill animate-[high-bounce_1s_infinite] [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-fg/40 rounded-pill animate-[high-bounce_1s_infinite] [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-fg/40 rounded-pill animate-[high-bounce_1s_infinite]"></div>
              </div>
            </div>
          )}

          {openPanel === 'sources' && hasSources && (
            <div className="px-4 pb-4 animate-fadeIn">
              {message.searchQuery && (
                <div className="mb-4 text-sm bg-surface rounded-surface p-3">
                  <span className="font-medium opacity-70">Search query:</span>{' '}
                  {message.searchUrl ? (
                    <a
                      href={message.searchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {message.searchQuery}
                    </a>
                  ) : (
                    <span>{message.searchQuery}</span>
                  )}
                </div>
              )}
              <MessageSources sources={message.sources!} />
            </div>
          )}

          {imagesOpenedOnce && (
            <div
              className={cn(
                'px-3 pb-3 animate-fadeIn',
                openPanel === 'images' ? 'block' : 'hidden',
              )}
            >
              <SearchImages
                query={query}
                chatHistory={chatHistory}
                messageId={messageId}
                onImagesLoaded={updateImageCount}
                isPrivate={isPrivateSession}
              />
            </div>
          )}

          {videosOpenedOnce && (
            <div
              className={cn(
                'px-3 pb-3 animate-fadeIn',
                openPanel === 'videos' ? 'block' : 'hidden',
              )}
            >
              <SearchVideos
                query={query}
                chatHistory={chatHistory}
                messageId={messageId}
                onVideosLoaded={updateVideoCount}
                isPrivate={isPrivateSession}
              />
            </div>
          )}

          {isLast && message.role === 'assistant' && !loading && (
            <>
              <div className="border-t border-surface-2 px-4 pt-4 mt-4">
                <div className="flex flex-row items-center space-x-2 mb-3">
                  <Layers3 size={20} />
                  <h3 className="text-xl font-medium">Related</h3>

                  {(!message.suggestions ||
                    message.suggestions.length === 0) && (
                    <button
                      onClick={handleLoadSuggestions}
                      disabled={loadingSuggestions}
                      className="px-4 py-2 flex flex-row items-center justify-center space-x-2 rounded-surface bg-surface hover:bg-surface-2 transition duration-200"
                    >
                      {loadingSuggestions ? (
                        <LoaderCircle
                          size={16}
                          className="animate-spin text-accent"
                        />
                      ) : (
                        <Sparkles size={16} />
                      )}
                      <span>
                        {loadingSuggestions
                          ? 'Loading suggestions...'
                          : 'Load suggestions'}
                      </span>
                    </button>
                  )}
                </div>

                {message.suggestions && message.suggestions.length > 0 && (
                  <div className="flex flex-col space-y-3 mt-2">
                    {message.suggestions.map((suggestion, i) => (
                      <div className="flex flex-col space-y-3 text-sm" key={i}>
                        <div className="h-px w-full bg-surface-2" />
                        <div
                          onClick={() => {
                            sendMessage(suggestion);
                          }}
                          className="cursor-pointer flex flex-row justify-between font-medium space-x-2 items-center"
                        >
                          <p className="transition duration-200 hover:text-accent">
                            {suggestion}
                          </p>
                          <Plus
                            size={20}
                            className="text-accent flex-shrink-0"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageTabs;
