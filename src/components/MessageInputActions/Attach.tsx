import { cn } from '@/lib/utils';
import ComposerActionButton from '@/components/MessageInputActions/ComposerActionButton';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { File, LoaderCircle, Paperclip, Plus, Trash } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';
import { File as FileType, ImageAttachment } from '../ChatWindow';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp';
const DOC_ACCEPT = '.pdf,.docx,.txt';

const Attach = ({
  fileIds,
  setFileIds,
  files,
  setFiles,
  pendingImages,
  setPendingImages,
  imageCapable = false,
}: {
  fileIds: string[];
  setFileIds: (fileIds: string[]) => void;
  files: FileType[];
  setFiles: (files: FileType[]) => void;
  pendingImages: ImageAttachment[];
  setPendingImages: (images: ImageAttachment[]) => void;
  imageCapable?: boolean;
}) => {
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setLoading(true);

    const imageFiles: globalThis.File[] = [];
    const docFiles: globalThis.File[] = [];

    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (IMAGE_EXTENSIONS.includes(ext)) {
        if (imageCapable) imageFiles.push(file);
      } else {
        docFiles.push(file);
      }
    }

    // Upload images
    if (imageFiles.length > 0) {
      const imgData = new FormData();
      imageFiles.forEach((f) => imgData.append('images', f));
      try {
        const res = await fetch('/api/uploads/images', {
          method: 'POST',
          body: imgData,
        });
        const resData = await res.json();
        if (res.ok && resData.images) {
          setPendingImages([...pendingImages, ...resData.images]);
        }
      } catch (err) {
        console.error('Image upload failed:', err);
      }
    }

    // Upload documents (existing behavior)
    if (docFiles.length > 0) {
      const data = new FormData();
      docFiles.forEach((f) => data.append('files', f));

      // Embedding model is resolved server-side from the DB (system setting);
      // only the chat model (for topic generation) is request-supplied.
      const chatModelProvider = localStorage.getItem('chatModelProvider');
      const chatModel = localStorage.getItem('chatModel');
      const contextWindowSize =
        localStorage.getItem('contextWindowSize') ||
        String(DEFAULT_CONTEXT_WINDOW);

      if (chatModelProvider !== null) {
        data.append('chat_model_provider', chatModelProvider);
      }
      if (chatModel !== null) {
        data.append('chat_model', chatModel);
      }
      data.append('context_window_size', contextWindowSize);

      try {
        const res = await fetch('/api/uploads', {
          method: 'POST',
          body: data,
        });
        const resData = await res.json();
        if (res.ok && resData.files) {
          setFiles([...files, ...resData.files]);
          setFileIds([
            ...fileIds,
            ...resData.files.map((file: Record<string, string>) => file.fileId),
          ]);
        }
      } catch (err) {
        console.error('Document upload failed:', err);
      }
    }

    setLoading(false);
    // Reset the input so the same file can be re-selected
    e.target.value = '';
  };

  return loading ? (
    <div className="flex flex-row items-center justify-between space-x-1">
      <LoaderCircle size={18} className="text-info animate-spin" />
      <p className="text-info inline whitespace-nowrap text-xs font-medium">
        Uploading..
      </p>
    </div>
  ) : files.length > 0 ? (
    <div className="relative group">
      <Popover className="relative w-full max-w-[15rem] md:max-w-md lg:max-w-lg">
        {({ open }) => (
          <>
            <PopoverButton
              as={ComposerActionButton}
              geometry="content"
              configured
              open={open}
              type="button"
              className={cn(
                'justify-between',
                files.length > 0 ? '-ml-2 lg:-ml-3' : '',
              )}
            >
              {files.length > 1 && (
                <>
                  <File size={19} className="text-accent" />
                  <p className="inline whitespace-nowrap text-xs font-medium text-accent">
                    {files.length} files
                  </p>
                </>
              )}

              {files.length === 1 && (
                <>
                  <File size={18} className="text-accent" />
                  <p className="text-xs font-medium text-accent">
                    {files[0].fileName.length > 10
                      ? files[0].fileName
                          .replace(/\.\w+$/, '')
                          .substring(0, 3) +
                        '...' +
                        files[0].fileExtension
                      : files[0].fileName}
                  </p>
                </>
              )}
            </PopoverButton>
            <Transition
              as={Fragment}
              enter="transition-[opacity,transform] ease-out duration-150"
              enterFrom="opacity-0 translate-y-1"
              enterTo="opacity-100 translate-y-0"
              leave="transition-[opacity,transform] ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0"
              leaveTo="opacity-0 translate-y-1"
            >
              <PopoverPanel className="absolute z-10 w-64 md:w-[350px] right-0">
                <div className="bg-surface border rounded-control border-surface-2 w-full max-h-[200px] md:max-h-none overflow-y-auto flex flex-col">
                  <div className="flex flex-row items-center justify-between px-3 py-2">
                    <h4 className="text-fg font-medium text-sm">
                      Attached files
                    </h4>
                    <div className="flex flex-row items-center space-x-4">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex flex-row items-center space-x-1 border border-transparent transition-colors duration-150 text-fg-muted hover:text-fg focus-border-neutral"
                      >
                        <input
                          type="file"
                          aria-label="Attach files"
                          onChange={handleChange}
                          ref={fileInputRef}
                          accept={
                            imageCapable
                              ? `${DOC_ACCEPT},${IMAGE_ACCEPT}`
                              : DOC_ACCEPT
                          }
                          multiple
                          hidden
                        />
                        <Plus size={18} />
                        <p className="text-xs">Add</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFiles([]);
                          setFileIds([]);
                        }}
                        className="flex flex-row items-center space-x-1 border border-transparent transition-colors duration-150 text-fg-muted hover:text-fg focus-border-neutral"
                      >
                        <Trash size={14} />
                        <p className="text-xs">Clear</p>
                      </button>
                    </div>
                  </div>
                  <div className="h-[0.5px] mx-2 bg-surface-2" />
                  <div className="flex flex-col items-center">
                    {files.map((file, i) => (
                      <div
                        key={i}
                        className="flex flex-row items-center justify-start w-full space-x-3 p-3"
                      >
                        <div className="bg-surface-2 flex items-center justify-center w-10 h-10 rounded-control">
                          <File size={16} className="text-fg-muted" />
                        </div>
                        <p className="text-fg-muted text-sm">
                          {file.fileName.length > 25
                            ? file.fileName
                                .replace(/\.\w+$/, '')
                                .substring(0, 25) +
                              '...' +
                              file.fileExtension
                            : file.fileName}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverPanel>
            </Transition>
          </>
        )}
      </Popover>
    </div>
  ) : (
    <div className="relative group">
      <ComposerActionButton
        geometry="compact"
        type="button"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Attach files"
      >
        <input
          type="file"
          aria-label="Attach files"
          onChange={handleChange}
          ref={fileInputRef}
          accept={imageCapable ? `${DOC_ACCEPT},${IMAGE_ACCEPT}` : DOC_ACCEPT}
          multiple
          hidden
        />
        <Paperclip size="18" />
      </ComposerActionButton>
    </div>
  );
};

export default Attach;
