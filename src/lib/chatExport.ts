import jsPDF from 'jspdf';
import { Message } from '@/components/ChatWindow';

export const downloadFile = (
  filename: string,
  content: string,
  type: string,
) => {
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

export const exportAsMarkdown = (messages: Message[], title: string) => {
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

export const exportAsPDF = (messages: Message[], title: string) => {
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
