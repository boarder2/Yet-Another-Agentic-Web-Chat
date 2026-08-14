import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';

const Rewrite = ({
  rewrite,
  messageId,
}: {
  rewrite: (messageId: string) => void;
  messageId: string;
}) => {
  return (
    <Button
      variant="ghost"
      icon={ArrowLeftRight}
      onClick={() => rewrite(messageId)}
      className="rounded-floating px-3 py-2"
    >
      Rewrite
    </Button>
  );
};

export default Rewrite;
