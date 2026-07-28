'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { File, ImageAttachment, Message } from './ChatWindow';
import CompactionIndicator from './CompactionIndicator';
import MessageBox from './MessageBox';
import MessageInput from './MessageInput';
import TodoWidget, { TodoItemData } from './TodoWidget';
import { Document } from '@langchain/core/documents';
import { PendingExecution, CodeExecutionApproval } from './CodeExecution';
import { PendingQuestion, UserQuestionPrompt } from './UserQuestionPrompt';
import {
  PendingEditApproval,
  WorkspaceEditApproval,
} from './WorkspaceEditApproval';
import {
  PendingSkillEditApproval,
  SkillEditApproval,
} from './SkillEditApproval';
import { PendingMcpApproval, McpToolApproval } from './McpToolApproval';

const PROSE_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,pre';

/**
 * Where to park the viewport when a chat is opened: the first block of the
 * answer's own prose. Answers routinely open with a wall of tool calls, which
 * is execution detail (`data-execution`) rather than something to read — skip
 * past it, falling back to the top of the message when there is no prose.
 */
const openAnchorFor = (message: HTMLElement): HTMLElement => {
  const body = message.querySelector('[data-answer]');
  const blocks = body?.querySelectorAll<HTMLElement>(PROSE_BLOCKS) ?? [];
  for (const block of blocks) {
    if (!block.closest('[data-execution]') && block.textContent?.trim())
      return block;
  }
  return message;
};

/** Breathing room between a scrolled-to block and whatever sits above it. */
const ANCHOR_GAP = 12;

/** Scroll `target` just clear of the bars that overlay the top of the page. */
const scrollBelowHeaders = (target: HTMLElement) => {
  const headers = document.querySelectorAll('[data-sticky-header]');
  const offset = Math.max(
    0,
    ...[...headers].map((h) => h.getBoundingClientRect().bottom),
  );
  window.scrollTo({
    top:
      target.getBoundingClientRect().top + window.scrollY - offset - ANCHOR_GAP,
    behavior: 'smooth',
  });
};

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
  pendingEditApprovals = {},
  onEditDecide,
  pendingSkillEditApprovals = {},
  onSkillEditDecide,
  pendingMcpApprovals = {},
  onMcpToolDecide,
  pendingImages,
  setPendingImages,
  imageCapable = false,
  isPrivateSession = false,
  workspaceId,
  searchCapabilities,
  topPadding,
  estimatedUsage,
  messageCount,
  onCompact,
  compacting,
  enabledSkills,
  skillNames,
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
  pendingEditApprovals?: Record<string, PendingEditApproval[]>;
  onEditDecide?: (
    approvalId: string,
    decision: 'accept' | 'accept_always' | 'reject' | 'always_prompt',
    freeformText?: string,
  ) => void;
  pendingSkillEditApprovals?: Record<string, PendingSkillEditApproval[]>;
  onSkillEditDecide?: (
    approvalId: string,
    decision: 'accept' | 'reject',
    freeformText?: string,
  ) => void;
  pendingMcpApprovals?: Record<string, PendingMcpApproval[]>;
  onMcpToolDecide?: (
    approvalId: string,
    approved: boolean,
    opts?: { alwaysAllow?: boolean },
  ) => void;
  pendingImages: ImageAttachment[];
  setPendingImages: (images: ImageAttachment[]) => void;
  imageCapable?: boolean;
  isPrivateSession?: boolean;
  workspaceId?: string | null;
  searchCapabilities?: {
    web: boolean;
    images: boolean;
    videos: boolean;
    autocomplete: boolean;
  };
  /** Top padding in px to clear all fixed header bars above the chat content. */
  topPadding?: number;
  estimatedUsage?: number;
  messageCount?: number;
  onCompact?: (instructions?: string) => void;
  compacting?: boolean;
  enabledSkills?: Array<{ name: string; description: string }>;
  skillNames?: Set<string>;
}) => {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [manuallyScrolledUp, setManuallyScrolledUp] = useState(false);
  const [inputStyle, setInputStyle] = useState<React.CSSProperties>({});
  const messageEnd = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(isAtBottom);
  const manuallyScrolledUpRef = useRef(manuallyScrolledUp);
  // Parked at the top of an answer (see the anchor effect below).
  const anchoredToTop = useRef(false);
  // The open-time anchor decision is made once per mount, never re-run.
  const openAnchorDecided = useRef(false);
  const SCROLL_THRESHOLD = 100; // pixels from bottom to consider "at bottom"
  // The in-flight message is the last user message while a response is loading.
  const currentMessageId = loading
    ? [...messages].reverse().find((m) => m.role === 'user')?.messageId
    : undefined;

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
      const atExactBottom = position >= height - 5;

      // Only reset manual scroll flag when user reaches the very bottom,
      // not just within the general threshold. This prevents auto-scroll
      // from re-engaging when the user is merely reading near the bottom.
      if (atExactBottom) {
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

    // Always scroll when user sends a message, resetting the scroll-tracking
    // state that the scroll listeners maintain. These resets are coupled to the
    // scroll side-effect performed here.
    if (messages[messages.length - 1]?.role === 'user') {
      anchoredToTop.current = false;
      scroll();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsAtBottom(true);
      setManuallyScrolledUp(false);
    }
  }, [messages]);

  // Keep refs in sync with state so effects watching scrollTrigger can read current values
  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  useEffect(() => {
    manuallyScrolledUpRef.current = manuallyScrolledUp;
  }, [manuallyScrolledUp]);

  // Opening an existing chat: start at the beginning of its last answer rather
  // than dumped at the end of it. Decided once per mount so a later run can't
  // re-anchor mid-thread. The latch (rather than the manuallyScrolledUp ref,
  // which a sibling sync effect rewrites from state) is what holds the
  // position: nothing else writes it, so the auto-scroll below can't undo it.
  useEffect(() => {
    if (openAnchorDecided.current || messages.length === 0) return;
    openAnchorDecided.current = true;
    const answer = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!answer) return;
    // A turn in flight follows the stream to the bottom instead. Each signal
    // covers a different open: `loading` for a send in this tab, a trailing
    // user row for a turn whose answer isn't persisted yet, and the run status
    // for attaching to a live run before `loading` commits.
    if (
      loading ||
      messages[messages.length - 1].role === 'user' ||
      answer.runStatus === 'running'
    )
      return;
    const el = document.getElementById(`msg-${answer.messageId}`);
    if (!el) return;
    anchoredToTop.current = true;
    scrollBelowHeaders(openAnchorFor(el));
    // Surface the scroll-to-bottom affordance, since we're deliberately parked
    // above the end of the thread.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManuallyScrolledUp(true);
  }, [loading, messages]);

  // Auto-scroll for assistant responses only if user is at bottom and hasn't manually scrolled up
  useEffect(() => {
    if (
      !anchoredToTop.current &&
      isAtBottomRef.current &&
      !manuallyScrolledUpRef.current &&
      messages.length > 0
    ) {
      messageEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [scrollTrigger, messages.length]);

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
    <div
      ref={containerRef}
      className="space-y-6 pb-48 sm:mx-4 md:mx-8"
      style={{ paddingTop: topPadding ?? 32 }}
    >
      {messages.map((msg, i) => {
        const isLast = i === messages.length - 1;

        if (msg.role === 'compaction' && msg.compaction) {
          return (
            <CompactionIndicator
              key={msg.messageId}
              compaction={msg.compaction}
            />
          );
        }

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
              gatheringSources={gatheringSources}
              actionMessageId={currentMessageId}
              isPrivateSession={isPrivateSession}
              searchCapabilities={searchCapabilities}
              skillNames={skillNames}
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
      <div className="fixed bottom-16 lg:bottom-0 z-40" style={inputStyle}>
        {/* Scroll to bottom button - appears above the MessageInput when user has scrolled up */}
        {manuallyScrolledUp && !isAtBottom && (
          <div className="absolute -top-14 right-2 z-10">
            <button
              type="button"
              onClick={() => {
                anchoredToTop.current = false;
                setManuallyScrolledUp(false);
                setIsAtBottom(true);
                messageEnd.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="bg-accent text-fg hover:bg-opacity-85 transition duration-100 rounded-pill px-4 py-2 shadow-raised flex items-center justify-center"
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
        {/* Workspace edit approval queue */}
        {(() => {
          const allPending = Object.values(pendingEditApprovals)
            .flat()
            .filter((a) => a.status === 'pending');
          if (allPending.length === 0 || !onEditDecide) return null;
          const current = allPending[0];
          return (
            <WorkspaceEditApproval
              key={current.approvalId}
              approvalId={current.approvalId}
              action={current.action}
              file={current.file}
              oldString={current.oldString}
              newString={current.newString}
              content={current.content}
              replaceAll={current.replaceAll}
              occurrences={current.occurrences}
              workspaceAutoAccept={current.workspaceAutoAccept}
              onDecide={onEditDecide}
              onDismiss={() => {
                setTimeout(() => {
                  document.getElementById('message-input')?.focus();
                }, 0);
              }}
              queuePosition={1}
              queueTotal={allPending.length}
            />
          );
        })()}
        {/* Skill edit approval queue */}
        {(() => {
          const allPending = Object.values(pendingSkillEditApprovals)
            .flat()
            .filter((a) => a.status === 'pending');
          if (allPending.length === 0 || !onSkillEditDecide) return null;
          const current = allPending[0];
          return (
            <SkillEditApproval
              key={current.approvalId}
              approvalId={current.approvalId}
              action={current.action}
              name={current.name}
              oldDescription={current.oldDescription}
              newDescription={current.newDescription}
              oldContent={current.oldContent}
              newContent={current.newContent}
              scope={current.scope}
              newScope={current.newScope}
              oldDisableModelInvocation={current.oldDisableModelInvocation}
              disableModelInvocation={current.disableModelInvocation}
              onDecide={onSkillEditDecide}
              onDismiss={() => {
                setTimeout(() => {
                  document.getElementById('message-input')?.focus();
                }, 0);
              }}
            />
          );
        })()}
        {/* MCP tool approval queue */}
        {(() => {
          const allPending = Object.values(pendingMcpApprovals)
            .flat()
            .filter((a) => a.status === 'pending');
          if (allPending.length === 0 || !onMcpToolDecide) return null;
          const current = allPending[0];
          return (
            <McpToolApproval
              key={current.approvalId}
              approvalId={current.approvalId}
              serverId={current.serverId}
              serverName={current.serverName}
              toolName={current.toolName}
              description={current.description}
              arguments={current.arguments}
              onDecide={onMcpToolDecide}
              onDismiss={() => {
                setTimeout(() => {
                  document.getElementById('message-input')?.focus();
                }, 0);
              }}
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
          workspaceId={workspaceId}
          estimatedUsage={estimatedUsage}
          messageCount={messageCount}
          onCompact={onCompact}
          compacting={compacting}
          enabledSkills={enabledSkills}
        />
      </div>
      <div ref={messageEnd} className="h-0" />
    </div>
  );
};

export default Chat;
