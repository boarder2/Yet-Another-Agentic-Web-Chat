'use client';

import { useEffect } from 'react';
import { useScheduledRunsUnread } from '@/lib/hooks/api/useScheduledTasks';
import { useActiveRuns } from '@/lib/hooks/api/useActiveRuns';

// Leading "(N) " badge we prepend to the tab title. Stripped before every
// recompute so the badge never compounds, and so the underlying title can be
// recovered no matter who last wrote document.title.
const BADGE_RE = /^\(\d+\)\s+/;

const stripBadge = (title: string) => title.replace(BADGE_RE, '');

/**
 * Maintains a global "(N) " prefix on the document title where N is the total
 * of unread + attention-seeking items (scheduled-run unread, history-run
 * unread, history awaiting-attention). The same TanStack queries that drive the
 * Sidebar badges feed this, so it stays in sync app-wide with no extra polling.
 *
 * A changed title on a backgrounded tab is what makes Firefox surface its
 * native "something happened here" dot, so the prefix alone produces the effect.
 *
 * ChatWindow and Next's metadata write document.title directly, so a one-shot
 * assignment would get clobbered on navigation. We watch document.head (not the
 * <title> node itself, which Next can swap out wholesale on navigation, leaving
 * a node-bound observer detached) for both title replacement and text changes,
 * re-applying the badge after any external write while ignoring our own writes
 * to avoid a feedback loop. Renders nothing.
 */
export default function TitleBadge() {
  const { data: scheduledUnread = 0 } = useScheduledRunsUnread();
  const { data: activeRuns } = useActiveRuns();

  const total =
    scheduledUnread +
    (activeRuns?.unreadCount ?? 0) +
    (activeRuns?.awaitingAttentionCount ?? 0);

  useEffect(() => {
    // The value we last wrote ourselves, so the observer can tell our own
    // mutation apart from an external one and skip it.
    let applied = '';

    const apply = () => {
      const base = stripBadge(document.title);
      const next = total > 0 ? `(${total}) ${base}` : base;
      if (document.title !== next) {
        applied = next;
        document.title = next;
      }
    };

    const observer = new MutationObserver(() => {
      if (document.title === applied) return;
      apply();
    });
    // Watch the whole head subtree: childList catches Next swapping the <title>
    // node on navigation; characterData catches direct document.title writes.
    observer.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    apply();

    return () => observer.disconnect();
  }, [total]);

  return null;
}
