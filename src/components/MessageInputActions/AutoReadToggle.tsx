import { Volume2, VolumeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
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
    <button
      type="button"
      onClick={() => setAutoRead(!autoRead)}
      className={cn(
        'flex items-center rounded-surface p-1 transition-colors duration-150 ease-in-out focus:outline-none',
        autoRead
          ? 'text-accent hover:text-accent'
          : 'text-fg/60 hover:text-fg/30',
      )}
      title={label}
      aria-label={label}
      aria-pressed={autoRead}
    >
      {autoRead ? <Volume2 size={18} /> : <VolumeOff size={18} />}
    </button>
  );
};

export default AutoReadToggle;
