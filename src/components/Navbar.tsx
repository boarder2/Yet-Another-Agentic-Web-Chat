import {
  Clock,
  Edit,
  EyeOff,
  Pin,
  Share,
  FileText,
  FileDown,
} from 'lucide-react';
import { Message } from './ChatWindow';
import { useEffect, useState, Fragment } from 'react';
import { formatTimeDifference } from '@/lib/utils';
import DeleteChat from './DeleteChat';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import jsPDF from 'jspdf';
import Link from 'next/link';

const downloadFile = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
};

const exportAsMarkdown = (messages: Message[], title: string) => {
  const date = new Date(messages[0]?.createdAt || Date.now()).toLocaleString();
  let md = `# 💬 Chat Export: ${title}\n\n`;
  md += `*Exported on: ${date}*\n\n---\n`;
  messages.forEach((msg, _idx) => {
    md += `\n---\n`;
    md += `**${msg.role === 'user' ? '🧑 User' : '🤖 Assistant'}**  
`;
    md += `*${new Date(msg.createdAt).toLocaleString()}*\n\n`;
    md += `> ${msg.content.replace(/\n/g, '\n> ')}\n`;
    if (msg.sources && msg.sources.length > 0) {
      md += `\n**Citations:**\n`;
      msg.sources.forEach((src: { metadata: { url?: string } }, i: number) => {
        const url = src.metadata?.url || '';
        md += `- [${i + 1}] [${url}](${url})\n`;
      });
    }
  });
  md += '\n---\n';
  downloadFile(`${title || 'chat'}.md`, md, 'text/markdown');
};

const exportAsPDF = (messages: Message[], title: string) => {
  const doc = new jsPDF();
  const date = new Date(messages[0]?.createdAt || Date.now()).toLocaleString();
  let y = 15;
  const pageHeight = doc.internal.pageSize.height;
  doc.setFontSize(18);
  doc.text(`Chat Export: ${title}`, 10, y);
  y += 8;
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Exported on: ${date}`, 10, y);
  y += 8;
  doc.setDrawColor(200);
  doc.line(10, y, 200, y);
  y += 6;
  doc.setTextColor(30);
  messages.forEach((msg, _idx) => {
    if (y > pageHeight - 30) {
      doc.addPage();
      y = 15;
    }
    doc.setFont('helvetica', 'bold');
    doc.text(`${msg.role === 'user' ? 'User' : 'Assistant'}`, 10, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`${new Date(msg.createdAt).toLocaleString()}`, 40, y);
    y += 6;
    doc.setTextColor(30);
    doc.setFontSize(12);
    const lines = doc.splitTextToSize(msg.content, 180);
    for (let i = 0; i < lines.length; i++) {
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 15;
      }
      doc.text(lines[i], 12, y);
      y += 6;
    }
    if (msg.sources && msg.sources.length > 0) {
      doc.setFontSize(11);
      doc.setTextColor(80);
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 15;
      }
      doc.text('Citations:', 12, y);
      y += 5;
      msg.sources.forEach((src: { metadata: { url?: string } }, i: number) => {
        const url = src.metadata?.url || '';
        if (y > pageHeight - 15) {
          doc.addPage();
          y = 15;
        }
        doc.text(`- [${i + 1}] ${url}`, 15, y);
        y += 5;
      });
      doc.setTextColor(30);
    }
    y += 6;
    doc.setDrawColor(230);
    if (y > pageHeight - 10) {
      doc.addPage();
      y = 15;
    }
    doc.line(10, y, 200, y);
    y += 4;
  });
  doc.save(`${title || 'chat'}.pdf`);
};

const Navbar = ({
  chatId,
  messages,
  isPrivateSession = false,
  pinned = false,
  setPinned,
}: {
  messages: Message[];
  chatId: string;
  isPrivateSession?: boolean;
  pinned?: boolean;
  setPinned?: (pinned: boolean) => void;
}) => {
  const [title, setTitle] = useState<string>('');
  const [timeAgo, setTimeAgo] = useState<string>('');
  const [expiresIn, setExpiresIn] = useState<string>('');

  useEffect(() => {
    if (messages.length > 0) {
      const newTitle =
        messages[0].content.length > 20
          ? `${messages[0].content.substring(0, 20).trim()}...`
          : messages[0].content;
      setTitle(newTitle);
      const newTimeAgo = formatTimeDifference(
        new Date(),
        messages[0].createdAt,
      );
      setTimeAgo(newTimeAgo);
    }
  }, [messages]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (messages.length > 0) {
        const newTimeAgo = formatTimeDifference(
          new Date(),
          messages[0].createdAt,
        );
        setTimeAgo(newTimeAgo);
      }
    }, 60000);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isPrivateSession || messages.length === 0) return;

    let durationMs = 24 * 60 * 60 * 1000; // default 24h

    const fetchAndCompute = async () => {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          if (typeof data.privateSessionDurationMinutes === 'number') {
            durationMs = data.privateSessionDurationMinutes * 60 * 1000;
          }
        }
      } catch {
        // use default
      }

      const computeExpiry = () => {
        const createdAt = new Date(messages[0].createdAt).getTime();
        const expiresAt = createdAt + durationMs;
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          setExpiresIn('expiring soon');
          return;
        }
        setExpiresIn(formatTimeDifference(new Date(), new Date(expiresAt)));
      };

      computeExpiry();
      const id = setInterval(computeExpiry, 60000);
      return id;
    };

    let intervalId: ReturnType<typeof setInterval> | undefined;
    fetchAndCompute().then((id) => {
      intervalId = id;
    });
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPrivateSession, messages]);

  return (
    <div className="fixed z-40 top-0 left-0 right-0 px-4 lg:pl-26 lg:pr-6 lg:px-8 flex flex-row items-center justify-between w-full py-4 text-sm border-b bg-bg border-surface-2">
      <Link
        href="/"
        className="active:scale-95 transition duration-100 cursor-pointer lg:hidden"
      >
        <Edit size={17} />
      </Link>
      <div className="hidden lg:flex flex-row items-center justify-center space-x-2">
        <Clock size={17} />
        <p className="text-xs">{timeAgo} ago</p>
      </div>
      {isPrivateSession ? (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium">
          <EyeOff size={13} />
          <span>Private</span>
        </div>
      ) : (
        <p className="hidden lg:flex">{title}</p>
      )}

      <div className="flex flex-row items-center space-x-4">
        <button
          aria-label={pinned ? 'Unpin chat' : 'Pin chat'}
          onClick={async () => {
            const next = !pinned;
            if (setPinned) setPinned(next);
            try {
              const res = await fetch(`/api/chats/${chatId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pinned: next }),
              });
              if (!res.ok && setPinned) setPinned(!next);
            } catch {
              if (setPinned) setPinned(!next);
            }
          }}
          className="active:scale-95 transition duration-100 cursor-pointer p-2 rounded-full hover:bg-surface-2"
        >
          <Pin size={17} className={pinned ? 'fill-current' : ''} />
        </button>
        <Popover className="relative">
          <PopoverButton className="active:scale-95 transition duration-100 cursor-pointer p-2 rounded-full hover:bg-surface-2">
            <Share size={17} />
          </PopoverButton>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <PopoverPanel className="absolute right-0 mt-2 w-64 rounded-xl shadow-xl bg-surface border border-surface-2 z-50">
              <div className="flex flex-col py-3 px-3 gap-2">
                <button
                  className="flex items-center gap-2 px-4 py-2 text-left hover:bg-surface-2 transition-colors rounded-lg font-medium"
                  onClick={() => exportAsMarkdown(messages, title || '')}
                >
                  <FileText size={17} className="text-accent" />
                  Export as Markdown
                </button>
                <button
                  className="flex items-center gap-2 px-4 py-2 text-left hover:bg-surface-2 transition-colors rounded-lg font-medium"
                  onClick={() => exportAsPDF(messages, title || '')}
                >
                  <FileDown size={17} className="text-accent" />
                  Export as PDF
                </button>
              </div>
            </PopoverPanel>
          </Transition>
        </Popover>
        <DeleteChat
          redirect
          chatId={chatId}
          chats={[]}
          setChats={() => {}}
          isPrivate={isPrivateSession}
          expiresIn={expiresIn}
        />
      </div>
    </div>
  );
};

export default Navbar;
