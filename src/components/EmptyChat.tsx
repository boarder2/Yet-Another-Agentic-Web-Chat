'use client';

import { Eye, EyeOff, Settings, Plus } from 'lucide-react';
import { File, ImageAttachment } from './ChatWindow';
import Link from 'next/link';
import MessageInput from './MessageInput';
import { cn } from '@/lib/utils';
import { useWidgetBoard } from '@/lib/hooks/useWidgetBoard';
import HomeWidgetBoard from './dashboard/HomeWidgetBoard';
import HomeWidgetToolbar from './dashboard/HomeWidgetToolbar';
import WidgetModals from './dashboard/WidgetModals';

import WorkspacePicker from './Workspaces/WorkspacePicker';

// How much of the widget board peeks above the bottom of the screen in "peek"
// mode — enough to signal there are widgets without being distracting. Larger
// screens reveal less; mobile keeps more since the bottom nav bar covers part
// of the sliver anyway. (Larger reveal ⇒ smaller min-height above the fold.)
const HOME_PEEK_MIN_HEIGHT =
  'min-h-[calc(100vh-6.5rem)] lg:min-h-[calc(100vh-2.5rem)]';

const EmptyChat = ({
  sendMessage,
  focusMode,
  setFocusMode,
  systemPromptIds,
  setSystemPromptIds,
  selectedMethodologyId,
  setSelectedMethodologyId,
  fileIds,
  setFileIds,
  files,
  setFiles,
  sendLocation,
  setSendLocation,
  sendPersonalization,
  setSendPersonalization,
  personalizationLocation,
  personalizationAbout,
  refreshPersonalization,
  pendingImages,
  setPendingImages,
  imageCapable = false,
  isPrivateSession = false,
  workspaceId,
  selectedWorkspaceId,
  setSelectedWorkspaceId,
  enabledSkills,
}: {
  sendMessage: (message: string) => void;
  focusMode: string;
  setFocusMode: (mode: string) => void;
  systemPromptIds: string[];
  setSystemPromptIds: (ids: string[]) => void;
  selectedMethodologyId: string | null;
  setSelectedMethodologyId: (id: string | null) => void;
  fileIds: string[];
  setFileIds: (fileIds: string[]) => void;
  files: File[];
  setFiles: (files: File[]) => void;
  sendLocation: boolean;
  setSendLocation: (value: boolean) => void;
  sendPersonalization: boolean;
  setSendPersonalization: (value: boolean) => void;
  personalizationLocation?: string;
  personalizationAbout?: string;
  refreshPersonalization?: () => void;
  pendingImages: ImageAttachment[];
  setPendingImages: (images: ImageAttachment[]) => void;
  imageCapable?: boolean;
  isPrivateSession?: boolean;
  workspaceId?: string;
  selectedWorkspaceId?: string | null;
  setSelectedWorkspaceId?: (id: string | null) => void;
  enabledSkills?: Array<{ name: string; description: string }>;
}) => {
  const basePath = workspaceId ? `/workspaces/${workspaceId}/c/new` : '/';

  // Home widgets only live on the true home page, never on workspace new-chat.
  const isHome = !workspaceId;
  const board = useWidgetBoard('home');
  const homeWidgets = isHome ? board.surfaceWidgets : [];
  // The input is always vertically centered in the first screen; the widget
  // board renders immediately below it. Show the board once home widgets exist
  // or while customizing (edit mode); wait for load to avoid a flash.
  const showBoard =
    isHome && !board.isLoading && (homeWidgets.length > 0 || board.isEditMode);
  // "Peek" mode pushes the board below the fold so only its top edge shows. It
  // is disabled while editing (you need to see widgets to arrange them) and
  // only kicks in once there are widgets to reveal.
  const peekActive =
    !!board.settings.homeWidgetsPeek &&
    !board.isEditMode &&
    homeWidgets.length > 0;

  const messageInput = (
    <MessageInput
      firstMessage={true}
      loading={false}
      sendMessage={sendMessage}
      focusMode={focusMode}
      setFocusMode={setFocusMode}
      fileIds={fileIds}
      setFileIds={setFileIds}
      files={files}
      systemPromptIds={systemPromptIds}
      setSystemPromptIds={setSystemPromptIds}
      selectedMethodologyId={selectedMethodologyId}
      setSelectedMethodologyId={setSelectedMethodologyId}
      setFiles={setFiles}
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
      enabledSkills={enabledSkills}
    />
  );

  const privateToggle = (
    <Link
      href={isPrivateSession ? basePath : `${basePath}?private=1`}
      title={
        isPrivateSession
          ? 'Private session — no personalization or memories'
          : 'Start private session'
      }
      className={cn(
        'flex items-center px-3 h-8 rounded-pill border text-sm transition-colors',
        isPrivateSession
          ? 'bg-warning-soft border-warning text-warning dark:text-warning'
          : 'bg-transparent border-surface-2 text-fg/40 hover:text-fg/70 hover:border-fg/20',
      )}
    >
      {isPrivateSession ? <EyeOff size={15} /> : <Eye size={15} />}
    </Link>
  );

  const inputCard = (
    <div className="flex flex-col items-center w-full max-w-screen-sm p-2 space-y-2">
      <div className="flex w-full items-center justify-between px-1">
        <div>
          {setSelectedWorkspaceId && (
            <WorkspacePicker
              value={selectedWorkspaceId ?? null}
              onChange={setSelectedWorkspaceId}
            />
          )}
        </div>
        {privateToggle}
      </div>
      {messageInput}
      {isHome && homeWidgets.length === 0 && (
        <button
          type="button"
          onClick={board.handleAddWidget}
          className="flex items-center gap-1.5 text-sm text-fg/50 hover:text-fg/80 transition-colors px-3 py-1.5 rounded-pill"
          title="Add a widget to your home page"
        >
          <Plus size={15} />
          <span>Add widget</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="relative">
      {isHome && <WidgetModals board={board} />}
      <div className="absolute top-0 right-0 z-10 flex flex-row items-center justify-end gap-2 mr-5 mt-5">
        {showBoard && <HomeWidgetToolbar board={board} />}
        <Link href="/settings">
          <Settings className="cursor-pointer lg:hidden" />
        </Link>
      </div>

      <div className="flex flex-col items-center min-h-screen">
        {peekActive ? (
          // Peek mode: the input centers in the space above the fold, leaving a
          // fixed sliver (HOME_PEEK_REVEAL) for the widget board to poke into.
          <div
            className={cn(
              'flex flex-col items-center justify-center w-full',
              HOME_PEEK_MIN_HEIGHT,
            )}
          >
            {inputCard}
          </div>
        ) : (
          // Default: a 50vh spacer drops the input to mid-screen, then
          // -translate-y-1/2 pulls it up by half its own height so it lands
          // dead-center regardless of its height. Widgets flow right after it.
          <>
            <div className="h-[50vh] shrink-0" aria-hidden />
            <div className="w-full flex flex-col items-center -translate-y-1/2">
              {inputCard}
            </div>
          </>
        )}

        {showBoard && (
          <div className={cn('w-full pb-12', !peekActive && '-mt-8')}>
            <HomeWidgetBoard board={board} />
          </div>
        )}
      </div>
    </div>
  );
};

export default EmptyChat;
