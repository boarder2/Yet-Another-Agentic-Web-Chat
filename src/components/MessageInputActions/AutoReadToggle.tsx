import { Volume2, VolumeOff } from 'lucide-react';
import ComposerActionButton from '@/components/MessageInputActions/ComposerActionButton';
import { useLocalStorageBoolean } from '@/lib/hooks/useLocalStorage';

/**
 * Composer action-bar toggle for "auto-read replies". One click flips it on/off;
 * the icon reflects state — `Volume2` when finished responses will read aloud
 * automatically, `VolumeOff` when they won't. Consumed in MessageTabs via the
 * `ttsAutoplay` localStorage key. Styled to match the other right-side icon
 * buttons in the input bar.
 */
const AutoReadToggle = () => {
  const [autoRead, setAutoRead] = useLocalStorageBoolean('ttsAutoplay', false);

  const label = autoRead ? 'Auto-read replies: on' : 'Auto-read replies: off';

  return (
    <ComposerActionButton
      geometry="compact"
      configured={autoRead}
      onClick={() => setAutoRead(!autoRead)}
      title={label}
      aria-label={label}
      aria-pressed={autoRead}
    >
      {autoRead ? <Volume2 size={18} /> : <VolumeOff size={18} />}
    </ComposerActionButton>
  );
};

export default AutoReadToggle;
