import type { Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Drives the global Memory UI inside Settings.
 *
 * Flow: open the settings modal → click "Memory" in the desktop nav →
 * interact with memory toggles, the memory list, add/delete/re-index.
 */
export class MemoryPage extends BasePage {
  private readonly settingsTrigger = this.page.getByLabel('Settings');
  private readonly closeBtn = this.page.getByLabel('Close');

  async open() {
    // Trigger the settings modal from any page.
    await this.settingsTrigger.first().click();
    await this.closeBtn.waitFor({ state: 'visible' });
    // Click the "Memory" nav item in the desktop sidebar.
    await this.page
      .locator('nav.hidden.lg\\:block button, .hidden.lg\\:block nav button')
      .filter({ hasText: 'Memory' })
      .first()
      .click();
    // Wait for the Memory section to render.
    await this.page
      .locator('h2.font-medium')
      .filter({ hasText: 'Memory' })
      .first()
      .waitFor({ state: 'visible' });
  }

  async close() {
    await this.closeBtn.click();
  }

  // ─── Memory toggle ───

  /** The "Memory" enable/disable AppSwitch (first toggle in the section). */
  private get memoryToggle(): Locator {
    return this.page
      .locator(
        '.flex.items-center.justify-between:has-text("Memory") button[role="switch"]',
      )
      .first();
  }

  /** Enable memory if not already enabled. */
  async enableMemory() {
    const isChecked = await this.memoryToggle.getAttribute('data-checked');
    if (isChecked !== '') {
      await this.memoryToggle.click();
      await this.page.waitForTimeout(300);
    }
  }

  async isMemoryEnabled(): Promise<boolean> {
    const checked = await this.memoryToggle.getAttribute('data-checked');
    return checked === '';
  }

  // ─── Memory list ───

  /** "N total" count displayed in the header row. */
  async totalCount(): Promise<number> {
    const el = this.page.locator('span.text-xs.text-fg\\/50');
    const texts = await el.allTextContents();
    for (const t of texts) {
      const m = t.match(/^(\d+)\s+total$/);
      if (m) return parseInt(m[1], 10);
    }
    return -1;
  }

  /** Wait for a specific memory's row to render — needed before reading
   * contents for a memory that was seeded via the API (not added through the
   * UI), since opening the section only waits for its heading, not for the
   * list fetch to resolve. */
  async waitForMemory(content: string) {
    await this.page.locator('.group.p-3').filter({ hasText: content }).waitFor({
      state: 'visible',
    });
  }

  /** All rendered memory content texts. */
  async memoryContents(): Promise<string[]> {
    const items = this.page.locator('.group.p-3 .text-sm.flex-1');
    const contents: string[] = [];
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent();
      if (text) contents.push(text.trim());
    }
    return contents;
  }

  // ─── Add ───

  /** Click "Add memory" to open the inline form. */
  async clickAddMemory() {
    await this.page.getByRole('button', { name: 'Add memory' }).click();
    await this.page
      .locator('textarea[aria-label="New memory content"]')
      .waitFor({ state: 'visible' });
  }

  /** Fill and save a new memory. */
  async addMemory(content: string) {
    await this.clickAddMemory();
    await this.page
      .locator('textarea[aria-label="New memory content"]')
      .fill(content);
    await this.page.getByRole('button', { name: 'Save' }).click();
    await this.waitForMemory(content);
  }

  // ─── Delete ───

  /** Delete a memory by its content text. Handles `window.confirm`. */
  async deleteMemory(content: string) {
    const row = this.page.locator('.group.p-3').filter({ hasText: content });
    const delBtn = row.locator('button[title="Delete"]');
    this.page.once('dialog', (d) => d.accept());
    await delBtn.click();
    await row.waitFor({ state: 'hidden' });
  }

  // ─── Re-index ───

  /** Click "Re-index" and accept the confirm dialog. */
  async reindex() {
    this.page.once('dialog', (d) => d.accept());
    await this.page.getByRole('button', { name: 'Re-index' }).click();
    // The button shows a spinner while pending, then returns to idle.
    // Wait for the spinner to appear then disappear.
    await this.page.waitForTimeout(1000);
  }
}
