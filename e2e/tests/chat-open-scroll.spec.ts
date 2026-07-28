import { test, expect } from '../fixtures';
import { seedChat, seedToolChat } from '../utils/seed';
import { uniq } from '../utils/helpers';
import type { Page } from '@playwright/test';

/**
 * Opening an existing chat parks the viewport at the start of what there is to
 * read in its last answer — past the execution widgets it opens with, clear of
 * any sticky header, and not at the bottom of the page. The rule is
 * unconditional for finished runs, so it must survive an already-seen chat.
 */

/** Open the chat and report where the viewport settled, in document coords. */
const openAndMeasure = async (page: Page, url: string) => {
  await page.goto(url);
  await expect(page.locator('[id^="msg-"]').last()).toBeVisible();
  // The anchor scrolls smoothly, so sample until the animation stops.
  let previous = -1;
  await expect
    .poll(async () => {
      const y = await page.evaluate(() => Math.round(window.scrollY));
      const settled = y > 0 && y === previous;
      previous = y;
      return settled;
    })
    .toBe(true);
  return page.evaluate(() => {
    const top = (el: Element) =>
      Math.round(el.getBoundingClientRect().top + window.scrollY);
    const messages = document.querySelectorAll('[id^="msg-"]');
    const answer = messages[messages.length - 1];
    const prose = [
      ...answer.querySelectorAll('[data-answer] p, [data-answer] h1'),
    ].find((el) => !el.closest('[data-execution]'));
    const header = document.querySelector('[data-sticky-header]');
    return {
      scrollY: Math.round(window.scrollY),
      answerTop: top(answer),
      proseTop: prose ? top(prose) : null,
      // Where the prose sits on screen, relative to the bar covering the top.
      proseBelowHeader: prose
        ? Math.round(
            prose.getBoundingClientRect().top -
              (header?.getBoundingClientRect().bottom ?? 0),
          )
        : null,
      widgetCount: answer.querySelectorAll('[data-execution]').length,
      hasHeader: header !== null,
      maxScroll: Math.round(document.body.scrollHeight - window.innerHeight),
    };
  });
};

/** Visible, and just below whatever bar overlays the top of the page. */
const expectParkedAtProse = (m: { proseBelowHeader: number | null }) => {
  expect(m.proseBelowHeader).not.toBeNull();
  expect(m.proseBelowHeader!).toBeGreaterThanOrEqual(0);
  expect(m.proseBelowHeader!).toBeLessThan(40);
};

test.describe('chat: open scroll position', () => {
  test('skips the answer’s tool calls and lands on its first prose block', async ({
    page,
    request,
  }) => {
    const { chatId, workspaceId } = await seedToolChat(request, {
      promptContent: uniq('scroll-anchor-tools'),
      chatModel: 'test-tool-long',
    });
    // A tool chat is seeded in a workspace, which owns its own chat route —
    // and a sticky header the anchor has to clear.
    const url = `/workspaces/${workspaceId}/c/${chatId}`;

    const first = await openAndMeasure(page, url);
    // The answer opens with a tool call and runs past the viewport, so the
    // prose, the widgets above it and the bottom of the page are all distinct.
    expect(first.hasHeader).toBe(true);
    expect(first.widgetCount).toBeGreaterThan(0);
    expect(first.proseTop!).toBeGreaterThan(first.answerTop);
    expect(first.maxScroll - first.proseTop!).toBeGreaterThan(100);
    expectParkedAtProse(first);

    // Re-opening (the chat is now marked seen) must anchor the same way.
    expectParkedAtProse(await openAndMeasure(page, url));
  });

  test('lands at the top of the message when the answer has no tool calls', async ({
    page,
    request,
  }) => {
    const chatId = await seedChat(request, {
      content: uniq('scroll-anchor-plain'),
      chatModel: 'test-long',
    });

    const measured = await openAndMeasure(page, `/c/${chatId}`);
    expect(measured.widgetCount).toBe(0);
    expect(measured.maxScroll - measured.proseTop!).toBeGreaterThan(100);
    expectParkedAtProse(measured);
    // Nothing to skip, so the prose is the top of the message either way.
    expect(measured.proseTop! - measured.answerTop).toBeLessThan(100);
  });
});
