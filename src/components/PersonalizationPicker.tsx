'use client';

import { Fragment, useEffect, useMemo, useRef } from 'react';
import {
  CloseButton,
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Settings as SettingsIcon, UserCog } from 'lucide-react';
import { useSettingsModal } from '@/components/settings/SettingsModalProvider';
import AppSwitch from '@/components/ui/AppSwitch';
import ComposerActionButton from '@/components/MessageInputActions/ComposerActionButton';
import ComposerPopover from '@/components/MessageInputActions/ComposerPopover';

type PersonalizationPickerProps = {
  hasLocation: boolean;
  hasProfile: boolean;
  sendLocation: boolean;
  setSendLocation: (value: boolean) => void;
  sendPersonalization: boolean;
  setSendPersonalization: (value: boolean) => void;
  locationPreview?: string;
  profilePreview?: string;
  onRefresh?: () => void;
};

type PopoverContentProps = {
  open: boolean;
  hasLocation: boolean;
  hasProfile: boolean;
  sendLocation: boolean;
  setSendLocation: (value: boolean) => void;
  sendPersonalization: boolean;
  setSendPersonalization: (value: boolean) => void;
  locationSummary: string;
  profileSummary: string;
  onRefresh?: () => void;
};

const truncate = (value?: string, max = 80) => {
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
};

const PopoverContent = ({
  open,
  hasLocation,
  hasProfile,
  sendLocation,
  setSendLocation,
  sendPersonalization,
  setSendPersonalization,
  locationSummary,
  profileSummary,
  onRefresh,
}: PopoverContentProps) => {
  const previousOpen = useRef(open);
  const { openSettings } = useSettingsModal();

  useEffect(() => {
    if (open && !previousOpen.current) {
      onRefresh?.();
    }
    previousOpen.current = open;
  }, [open, onRefresh]);

  return (
    <>
      <PopoverButton
        as={ComposerActionButton}
        geometry="compact"
        configured={sendLocation || sendPersonalization}
        open={open}
        title="Personalization options"
      >
        <UserCog size={18} />
      </PopoverButton>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-200"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-150"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
      >
        <PopoverPanel className="absolute right-0 z-30 w-80 transform bottom-full mb-2 overflow-hidden">
          <ComposerPopover
            title="Personalization"
            description="Choose what to send with this message."
            action={
              <CloseButton
                type="button"
                onClick={() => openSettings('personalization')}
                className="text-xs inline-flex items-center gap-1 text-accent hover:underline"
                title="Open personalization settings"
              >
                <SettingsIcon size={14} />
              </CloseButton>
            }
          >
            <div className="px-4 py-3 space-y-4 text-sm">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Send location</span>
                  <AppSwitch
                    checked={sendLocation && hasLocation}
                    onChange={(value) => {
                      if (!hasLocation) return;
                      setSendLocation(value);
                    }}
                    disabled={!hasLocation}
                    aria-label="Send location"
                  />
                </div>
                <p className="text-xs text-fg/60">{locationSummary}</p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Send personalization</span>
                  <AppSwitch
                    checked={sendPersonalization && hasProfile}
                    onChange={(value) => {
                      if (!hasProfile) return;
                      setSendPersonalization(value);
                    }}
                    disabled={!hasProfile}
                    aria-label="Send personalization"
                  />
                </div>
                <p className="text-xs text-fg/60">{profileSummary}</p>
              </div>
            </div>
          </ComposerPopover>
        </PopoverPanel>
      </Transition>
    </>
  );
};

const PersonalizationPicker = ({
  hasLocation,
  hasProfile,
  sendLocation,
  setSendLocation,
  sendPersonalization,
  setSendPersonalization,
  locationPreview,
  profilePreview,
  onRefresh,
}: PersonalizationPickerProps) => {
  const locationSummary = useMemo(() => {
    if (!hasLocation) return 'No location saved';
    return truncate(locationPreview);
  }, [hasLocation, locationPreview]);

  const profileSummary = useMemo(() => {
    if (!hasProfile) return 'No personalization saved';
    return truncate(profilePreview);
  }, [hasProfile, profilePreview]);

  return (
    <Popover className="relative">
      {({ open }) => (
        <PopoverContent
          open={open}
          hasLocation={hasLocation}
          hasProfile={hasProfile}
          sendLocation={sendLocation}
          setSendLocation={setSendLocation}
          sendPersonalization={sendPersonalization}
          setSendPersonalization={setSendPersonalization}
          locationSummary={locationSummary}
          profileSummary={profileSummary}
          onRefresh={onRefresh}
        />
      )}
    </Popover>
  );
};

export default PersonalizationPicker;
