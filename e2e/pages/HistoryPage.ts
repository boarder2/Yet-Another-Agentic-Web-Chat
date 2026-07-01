import type { Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class HistoryPage extends BasePage {
  readonly heading = this.page.getByRole('heading', {
    name: 'History',
    exact: true,
  });

  /** All chat rows in the browse list. */
  private readonly chatRows = this.page.locator('[role="link"]');

  /** The summary line: "N message(s) in N conversation(s)". Matched by text,
   * not its (shared) utility classes — chat rows render status pill badges
   * with the same `text-xs text-fg/50` classes, which a class locator would
   * also match. */
  private readonly summary = this.page.getByText(
    /\d+\s+messages?\s+in\s+\d+\s+conversations?/,
  );

  async goto() {
    await super.goto('/history');
    await this.heading.waitFor({ state: 'visible' });
  }

  /** Wait until at least one chat row is visible. */
  async waitForChats() {
    await this.chatRows.first().waitFor({ state: 'visible', timeout: 15_000 });
  }

  /** Read the visible text of every chat-title element inside the rows. */
  async chatTitles(): Promise<string[]> {
    const titles: string[] = [];
    const count = await this.chatRows.count();
    for (let i = 0; i < count; i++) {
      const el = this.chatRows
        .nth(i)
        .locator('.lg\\:text-xl.font-medium.truncate');
      if ((await el.count()) > 0) {
        titles.push((await el.textContent()) ?? '');
      }
    }
    return titles;
  }

  /** Read the summary counts as parsed numbers. Returns null if not present. */
  async summaryCounts(): Promise<{
    messages: number;
    conversations: number;
  } | null> {
    // The summary text is like "N message(s) in N conversation(s)".
    const text = await this.summary.textContent();
    if (!text) return null;
    const msgMatch = text.match(/(\d+)\s+message/);
    const convMatch = text.match(/(\d+)\s+conversation/);
    if (!msgMatch || !convMatch) return null;
    return {
      messages: parseInt(msgMatch[1], 10),
      conversations: parseInt(convMatch[1], 10),
    };
  }

  /** Locator for a chat row whose title matches the given text. */
  chatRowWithTitle(title: string): Locator {
    return this.chatRows.filter({
      has: this.page.locator('.lg\\:text-xl.font-medium.truncate', {
        hasText: title,
      }),
    });
  }
}
