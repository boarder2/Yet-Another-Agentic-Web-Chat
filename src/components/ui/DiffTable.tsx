import type { ReactNode } from 'react';

export type DiffLine =
  | { type: 'context'; text: string; lineNo: number }
  | { type: 'removed'; text: string; lineNo: number }
  | { type: 'added'; text: string; newLineNo: number };

export function DiffTable({
  lines,
  banner,
}: {
  lines: readonly DiffLine[];
  banner?: ReactNode;
}) {
  return (
    <div className="font-mono text-xs overflow-x-auto">
      {banner && (
        <div className="px-3 py-1 text-fg-subtle bg-surface-2/30 border-b border-surface-2 italic">
          {banner}
        </div>
      )}
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, idx) => (
            <tr
              key={idx}
              className={
                line.type === 'removed'
                  ? 'bg-danger-soft'
                  : line.type === 'added'
                    ? 'bg-success-soft'
                    : ''
              }
            >
              <td className="select-none w-10 px-2 py-0.5 text-right text-fg-subtle border-r border-surface-2 align-top">
                {line.type === 'removed'
                  ? line.lineNo
                  : line.type === 'added'
                    ? line.newLineNo
                    : line.lineNo}
              </td>
              <td className="px-2 py-0.5 whitespace-pre-wrap break-all">
                <span
                  className={
                    line.type === 'removed'
                      ? 'text-danger'
                      : line.type === 'added'
                        ? 'text-success'
                        : 'text-fg-muted'
                  }
                >
                  {line.type === 'removed'
                    ? '−'
                    : line.type === 'added'
                      ? '+'
                      : ' '}
                </span>{' '}
                <span className="text-fg">{line.text}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
