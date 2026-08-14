import AppSwitch from '@/components/ui/AppSwitch';

/**
 * "Vision capable" toggle row. Marks the selected chat model as accepting image
 * attachments.
 */
export default function VisionToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-xs text-fg-muted">Vision capable</span>
        <p className="text-[10px] text-fg-subtle mt-0.5">
          Allow image attachments for the selected chat model
        </p>
      </div>
      <AppSwitch checked={checked} onChange={onChange} />
    </div>
  );
}
