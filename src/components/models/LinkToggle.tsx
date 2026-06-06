import AppSwitch from '@/components/ui/AppSwitch';

/**
 * "Link System to Chat" toggle row. When on, the system model mirrors the chat
 * model and the system field is disabled by the parent `ModelPicker`.
 */
export default function LinkToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-xs text-fg/80">Link System to Chat</span>
        <p className="text-[10px] text-fg/50 mt-0.5">
          Keep the System model in sync with the Chat model
        </p>
      </div>
      <AppSwitch checked={checked} onChange={onChange} />
    </div>
  );
}
