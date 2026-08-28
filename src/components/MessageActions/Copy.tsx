import { Check, ClipboardList } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { Message } from '../ChatWindow';
import { replaceMapWidgetsForOutput } from '@/lib/widgets/envelope';
import { useState } from 'react';

const Copy = ({
  message,
  initialMessage,
}: {
  message: Message;
  initialMessage: string;
}) => {
  const [copied, setCopied] = useState(false);

  return (
    <IconButton
      icon={copied ? Check : ClipboardList}
      label={copied ? 'Copied' : 'Copy response'}
      onClick={() => {
        const contentToCopy = `${replaceMapWidgetsForOutput(initialMessage)}${message.sources && message.sources.length > 0 && `\n\nCitations:\n${message.sources?.map((source, i: number) => `[${i + 1}] ${source.metadata.url}`).join(`\n`)}`}`;
        navigator.clipboard.writeText(contentToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
      }}
      className="rounded-floating p-2"
    />
  );
};

export default Copy;
