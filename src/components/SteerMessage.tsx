import { CornerDownRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';

/** A steer the agent received mid-turn, placed where it landed in the answer. */
const SteerMessage = ({ content }: { content: string }) => (
  <div className="flex justify-end my-3" data-testid="steer-message">
    <Card className="flex items-start gap-2 max-w-[85%] px-3 py-2">
      <CornerDownRight
        size={14}
        className="mt-0.5 shrink-0 text-accent"
        aria-hidden
      />
      <span className="sr-only">You redirected the agent:</span>
      <span className="whitespace-pre-wrap break-words text-sm text-fg-muted">
        {content}
      </span>
    </Card>
  </div>
);

export default SteerMessage;
