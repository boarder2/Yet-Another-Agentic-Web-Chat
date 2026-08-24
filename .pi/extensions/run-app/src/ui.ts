import { BorderedLoader } from '@earendil-works/pi-coding-agent';
import type {
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { pagerArgs, type Pager, type PagerResult } from './logs.ts';

export interface LoaderOutcome<T> {
  value?: T;
  error?: unknown;
  cancelled: boolean;
}

export async function withCancellableLoader<T>(
  ctx: ExtensionCommandContext,
  message: string,
  externalSignal: AbortSignal,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<LoaderOutcome<T>> {
  if (ctx.mode !== 'tui') {
    try {
      return {
        value: await work(externalSignal),
        cancelled: externalSignal.aborted,
      };
    } catch (error) {
      return { error, cancelled: externalSignal.aborted };
    }
  }

  const result = await ctx.ui.custom<LoaderOutcome<T>>(
    (tui, theme, _keybindings, done) => {
      const loader = new BorderedLoader(tui, theme, message);
      loader.onAbort = () => {
        // BorderedLoader aborts its signal before calling this hook. Keep the
        // component open until the process cleanup has completed.
      };
      const signal = combineSignals(externalSignal, loader.signal);
      void work(signal).then(
        (value) => done({ value, cancelled: signal.aborted }),
        (error) => done({ error, cancelled: signal.aborted }),
      );
      return loader;
    },
  );

  return result ?? { cancelled: true };
}

export async function openPagerInTui(
  ctx: ExtensionCommandContext,
  path: string,
  pager: Pager,
): Promise<PagerResult | null> {
  if (ctx.mode !== 'tui') return null;
  return ctx.ui.custom<PagerResult>((tui, _theme, _keybindings, done) => {
    tui.stop();
    let result: PagerResult;
    try {
      process.stdout.write('\x1b[2J\x1b[H');
      result = pager.open('less', pagerArgs(path), ctx.cwd);
    } catch (error) {
      result = {
        status: null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      tui.start();
      tui.requestRender(true);
    }
    done(result);
    return { render: () => [], invalidate: () => {} };
  });
}

export function setFooterStatus(
  ctx: ExtensionContext,
  text: string | undefined,
): void {
  ctx.ui.setStatus('run-app', text);
}

function combineSignals(left: AbortSignal, right: AbortSignal): AbortSignal {
  return AbortSignal.any([left, right]);
}
