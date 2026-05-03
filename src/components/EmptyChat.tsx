import { Eye, EyeOff, Settings } from 'lucide-react';
import { File, ImageAttachment } from './ChatWindow';
import Link from 'next/link';
import MessageInput from './MessageInput';
import { cn } from '@/lib/utils';

import WorkspacePicker from './Workspaces/WorkspacePicker';

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
}) => {
  const basePath = workspaceId ? `/workspaces/${workspaceId}/c/new` : '/';
  return (
    <div className="relative">
      <div className="absolute w-full flex flex-row items-center justify-end mr-5 mt-5">
        <Link href="/settings">
          <Settings className="cursor-pointer lg:hidden" />
        </Link>
      </div>
      <div className="flex flex-col items-center justify-center min-h-screen max-w-screen-sm mx-auto p-2 space-y-4">
        <div className="flex flex-col items-center justify-center w-full space-y-2">
          <div className="flex w-full items-center justify-between px-1">
            <div>
              {setSelectedWorkspaceId && (
                <WorkspacePicker
                  value={selectedWorkspaceId ?? null}
                  onChange={setSelectedWorkspaceId}
                />
              )}
            </div>
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
          </div>
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
          />
        </div>
      </div>
    </div>
  );
};

export default EmptyChat;
