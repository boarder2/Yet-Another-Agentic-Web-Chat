'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { File, ImageAttachment, Message } from './ChatWindow';
import MessageBox from './MessageBox';
import MessageInput from './MessageInput';
import TodoWidget, { TodoItemData } from './TodoWidget';
import { Document } from '@langchain/core/documents';
import { PendingExecution, CodeExecutionApproval } from './CodeExecution';
import { PendingQuestion, UserQuestionPrompt } from './UserQuestionPrompt';

const Chat = ({
  loading,
  messages,
  sendMessage,
  scrollTrigger,
  rewrite,
  fileIds,
  setFileIds,
  files,
  setFiles,
  focusMode,
  setFocusMode,
  handleEditMessage,
  analysisProgress,
  modelStats,
  systemPromptIds,
  setSystemPromptIds,
  selectedMethodologyId,
  setSelectedMethodologyId,
  onThinkBoxToggle,
  gatheringSources = [],
  sendLocation,
  setSendLocation,
  sendPersonalization,
  setSendPersonalization,
  personalizationLocation,
  personalizationAbout,
  refreshPersonalization,
  todoItems = [],
  pendingExecutions = {},
  onExecutionAction,
  pendingQuestions = {},
  onQuestionAnswer,
  onQuestionSkip,
  pendingImages,
  setPendingImages,
  imageCapable = false,
  isPrivateSession = false,
  searchCapabilities,
}: {
  messages: Message[];
  sendMessage: (
    message: string,
    options?: {
      messageId?: string;
      rewriteIndex?: number;
      suggestions?: string[];
    },
  ) => void;
  loading: boolean;
  scrollTrigger: number;
  rewrite: (messageId: string) => void;
  fileIds: string[];
  setFileIds: (fileIds: string[]) => void;
  files: File[];
  setFiles: (files: File[]) => void;
  focusMode: string;
  setFocusMode: (mode: string) => void;
  handleEditMessage: (
    messageId: string,
    content: string,
    images?: ImageAttachment[],
  ) => void;
  analysisProgress: {
    message: string;
    current: number;
    total: number;
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
  systemPromptIds: string[];
  setSystemPromptIds: (ids: string[]) => void;
  selectedMethodologyId: string | null;
  setSelectedMethodologyId: (id: string | null) => void;
  onThinkBoxToggle: (
    messageId: string,
    thinkBoxId: string,
    expanded: boolean,
  ) => void;
  gatheringSources?: Array<{
    searchQuery: string;
    sources: Document[];
  }>;
  sendLocation: boolean;
  setSendLocation: (value: boolean) => void;
  sendPersonalization: boolean;
  setSendPersonalization: (value: boolean) => void;
  personalizationLocation?: string;
  personalizationAbout?: string;
  refreshPersonalization?: () => void;
  todoItems?: TodoItemData[];
  pendingExecutions?: Record<string, PendingExecution[]>;
  onExecutionAction?: (executionId: string, approved: boolean) => void;
  pendingQuestions?: Record<string, PendingQuestion[]>;
  onQuestionAnswer?: (
    questionId: string,
    response: { selectedOptions?: string[]; freeformText?: string },
  ) => void;
  onQuestionSkip?: (questionId: string) => void;
  pendingImages: ImageAttachment[];
  setPendingImages: (images: ImageAttachment[]) => void;
  imageCapable?: boolean;
  isPrivateSession?: boolean;
  searchCapabilities?: {
    web: boolean;
    images: boolean;
    videos: boolean;
    autocomplete: boolean;
  };
}) => {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [manuallyScrolledUp, setManuallyScrolledUp] = useState(false);
  const [inputStyle, setInputStyle] = useState<React.CSSProperties>({});
  const messageEnd = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const SCROLL_THRESHOLD = 250; // pixels from bottom to consider "at bottom"
  const [currentMessageId, setCurrentMessageId] = useState<string | undefined>(
    undefined,
  );

  // Check if user is at bottom of page
  useEffect(() => {
    const checkIsAtBottom = () => {
      const position = window.innerHeight + window.scrollY;
      const height = document.body.scrollHeight;
      const atBottom = position >= height - SCROLL_THRESHOLD;

      setIsAtBottom(atBottom);
    };

    // Initial check
    checkIsAtBottom();

    // Add scroll event listener
    window.addEventListener('scroll', checkIsAtBottom);

    return () => {
      window.removeEventListener('scroll', checkIsAtBottom);
    };
  }, []);

  // Detect wheel and touch events to identify user's scrolling direction
  useEffect(() => {
    const checkIsAtBottom = () => {
      const position = window.innerHeight + window.scrollY;
      const height = document.body.scrollHeight;
      const atBottom = position >= height - SCROLL_THRESHOLD;

      // If user scrolls to bottom, reset the manuallyScrolledUp flag
      if (atBottom) {
        setManuallyScrolledUp(false);
      }

      setIsAtBottom(atBottom);
    };

    const handleWheel = (e: WheelEvent) => {
      // Positive deltaY means scrolling down, negative means scrolling up
      if (e.deltaY < 0) {
        // User is scrolling up
        setManuallyScrolledUp(true);
      } else if (e.deltaY > 0) {
        checkIsAtBottom();
      }
    };

    const handleTouchStart = (_e: TouchEvent) => {
      // Immediately stop auto-scrolling on any touch interaction
      setManuallyScrolledUp(true);
    };

    // Add event listeners
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
    };
  }, [isAtBottom]);

  // Scroll when user sends a message
  useEffect(() => {
    const scroll = () => {
      messageEnd.current?.scrollIntoView({ behavior: 'smooth' });
    };

    if (messages.length === 1) {
      document.title = `${messages[0].content.substring(0, 30)} - YAAWC`;
    }

    // Always scroll when user sends a message
    if (messages[messages.length - 1]?.role === 'user') {
      scroll();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsAtBottom(true); // Reset to true when user sends a message
      setManuallyScrolledUp(false); // Reset manually scrolled flag when user sends a message
    }
  }, [messages]);

  // Auto-scroll for assistant responses only if user is at bottom and hasn't manually scrolled up
  useEffect(() => {
    const position = window.innerHeight + window.scrollY;
    const height = document.body.scrollHeight;
    const atBottom = position >= height - SCROLL_THRESHOLD;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsAtBottom(atBottom);

    if (isAtBottom && !manuallyScrolledUp && messages.length > 0) {
      messageEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [scrollTrigger, isAtBottom, messages.length, manuallyScrolledUp]);

  // Sync input width with main container width
  useEffect(() => {
    const updateInputStyle = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setInputStyle({
          width: rect.width,
          left: rect.left,
          right: window.innerWidth - rect.right,
        });
      }
    };

    // Initial calculation
    updateInputStyle();

    // Update on resize
    window.addEventListener('resize', updateInputStyle);

    return () => {
      window.removeEventListener('resize', updateInputStyle);
    };
  }, []);

  // Track the last user messageId when loading starts
  useEffect(() => {
    if (loading) {
      // Find the last user message
      const lastUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === 'user');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentMessageId(lastUserMsg?.messageId);
      //console.log('Set currentMessageId to', lastUserMsg?.messageId, messages);
    } else {
      setCurrentMessageId(undefined);
    }
  }, [loading, messages]);

  // Cancel handler
  const handleCancel = async () => {
    if (!currentMessageId) return;
    try {
      await fetch('/api/chat/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: currentMessageId }),
      });
    } catch (_e) {
      // Optionally handle error
    }
  };

  return (
    <div ref={containerRef} className="space-y-6 pt-8 pb-48 sm:mx-4 md:mx-8">
      {messages.map((msg, i) => {
        const isLast = i === messages.length - 1;

        return (
          <Fragment key={msg.messageId}>
            <MessageBox
              key={i}
              message={msg}
              messageIndex={i}
              history={messages}
              loading={loading}
              isLast={isLast}
              rewrite={rewrite}
              sendMessage={sendMessage}
              handleEditMessage={handleEditMessage}
              onThinkBoxToggle={onThinkBoxToggle}
              analysisProgress={analysisProgress}
              modelStats={modelStats}
              gatheringSources={gatheringSources}
              actionMessageId={currentMessageId}
              isPrivateSession={isPrivateSession}
              searchCapabilities={searchCapabilities}
              editInputProps={{
                fileIds,
                setFileIds,
                files,
                setFiles,
                focusMode,
                setFocusMode,
                systemPromptIds,
                setSystemPromptIds,
                selectedMethodologyId,
                setSelectedMethodologyId,
                sendLocation,
                setSendLocation,
                sendPersonalization,
                setSendPersonalization,
                personalizationLocation,
                personalizationAbout,
                refreshPersonalization,
                imageCapable,
              }}
            />
          </Fragment>
        );
      })}
      <div className="fixed bottom-16 lg:bottom-6 z-40" style={inputStyle}>
        {/* Scroll to bottom button - appears above the MessageInput when user has scrolled up */}
        {manuallyScrolledUp && !isAtBottom && (
          <div className="absolute -top-14 right-2 z-10">
            <button
              onClick={() => {
                setManuallyScrolledUp(false);
                setIsAtBottom(true);
                messageEnd.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="bg-accent text-fg hover:bg-opacity-85 transition duration-100 rounded-full px-4 py-2 shadow-lg flex items-center justify-center"
              aria-label="Scroll to bottom"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 mr-1"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
                  clipRule="evenodd"
                  transform="rotate(180 10 10)"
                />
              </svg>
              <span className="text-sm">Scroll to bottom</span>
            </button>
          </div>
        )}

        {todoItems && todoItems.length > 0 && <TodoWidget items={todoItems} />}
        {/* Code execution approval queue */}
        {(() => {
          const allPending = Object.values(pendingExecutions)
            .flat()
            .filter((e) => e.status === 'pending');
          if (allPending.length === 0) return null;
          const current = allPending[0];
          return (
            <CodeExecutionApproval
              key={current.executionId}
              executionId={current.executionId}
              code={current.code}
              description={current.description}
              onActionTaken={onExecutionAction}
              queuePosition={1}
              queueTotal={allPending.length}
            />
          );
        })()}
        {/* User question prompt queue */}
        {(() => {
          const allPending = Object.values(pendingQuestions)
            .flat()
            .filter((q) => q.status === 'pending');
          if (allPending.length === 0 || !onQuestionAnswer || !onQuestionSkip)
            return null;
          const current = allPending[0];
          return (
            <UserQuestionPrompt
              key={current.questionId}
              questionId={current.questionId}
              question={current.question}
              options={current.options}
              multiSelect={current.multiSelect}
              allowFreeformInput={current.allowFreeformInput}
              context={current.context}
              createdAt={current.createdAt}
              onSubmit={onQuestionAnswer}
              onSkip={onQuestionSkip}
              onDismiss={() => {
                // Return focus to the message input after question is dismissed
                setTimeout(() => {
                  document.getElementById('message-input')?.focus();
                }, 0);
              }}
              queuePosition={1}
              queueTotal={allPending.length}
            />
          );
        })()}
        <MessageInput
          firstMessage={messages.length === 0}
          loading={loading}
          sendMessage={sendMessage}
          fileIds={fileIds}
          setFileIds={setFileIds}
          files={files}
          setFiles={setFiles}
          focusMode={focusMode}
          setFocusMode={setFocusMode}
          onCancel={handleCancel}
          systemPromptIds={systemPromptIds}
          setSystemPromptIds={setSystemPromptIds}
          selectedMethodologyId={selectedMethodologyId}
          setSelectedMethodologyId={setSelectedMethodologyId}
          sendLocation={sendLocation}
          setSendLocation={setSendLocation}
          sendPersonalization={sendPersonalization}
          setSendPersonalization={setSendPersonalization}
          personalizationLocation={personalizationLocation}
          personalizationAbout={personalizationAbout}
          refreshPersonalization={refreshPersonalization}
          pendingImages={pendingImages}
          setPendingImages={setPendingImages}
          imageCapable={imageCapable}
          isPrivateSession={isPrivateSession}
        />
      </div>
      <div ref={messageEnd} className="h-0" />
    </div>
  );
};

export default Chat;
