const KB = 1024;
const MB = 1024 * 1024;

export function formatTokens(n: number): string {
  if (n >= MB) return `${(n / MB).toFixed(1)}M`;
  if (n >= KB) return `${(n / KB).toFixed(0)}K`;
  return String(n);
}
