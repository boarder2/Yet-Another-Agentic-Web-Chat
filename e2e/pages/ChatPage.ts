import type { Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/** The home composer and the in-conversation chat window share this markup. */
export class ChatPage extends BasePage {
  readonly input = this.page.locator('#message-input');
  readonly submit = this.page.locator('button[type="submit"]');
  readonly cancelButton = this.page.getByRole('button', {
    name: 'Cancel',
    exact: true,
  });
  readonly focusButton = this.page.getByTitle('Focus Mode');
  readonly sourcesButton = this.page.getByTitle('Sources');
  readonly attachInput = this.page.locator('input[aria-label="Attach files"]');
  readonly panelButton = this.page.getByTitle('Agent Panel');

  async goto(path = '/') {
    await super.goto(path);
    await this.input.waitFor({ state: 'visible' });
  }

  async sendMessage(text: string) {
    await this.input.fill(text);
    await this.submit.click();
  }

  /** The submit button only reappears once the run is no longer streaming. */
  async waitForStreamComplete() {
    await this.submit.waitFor({ state: 'visible', timeout: 15_000 });
  }

  async selectFocusMode(title: string) {
    await this.focusButton.click();
    // Scope to the open popover panel (ring-1 ring-surface-2 is unique to
    // it) — plain text like "Chat" also matches the sidebar nav link.
    const panel = this.page.locator('div.ring-1.ring-surface-2');
    await panel.getByText(title, { exact: true }).click();
    // The mode options are plain divs (no CloseButton), so the popover
    // panel stays open after a click — close it so it doesn't cover the
    // composer for subsequent interactions.
    await this.page.keyboard.press('Escape');
  }

  /** Switch the chat model via the composer's "Configure models" dialog. */
  async selectChatModel(displayName: string) {
    await this.page.getByRole('button', { name: 'Configure models' }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.locator('button:has(svg.lucide-cpu)').first().click();
    const popover = this.page
      .locator('div.overflow-hidden.shadow-raised')
      .first();
    await popover.locator('span.font-medium', { hasText: displayName }).click();
    await dialog.getByRole('button', { name: 'Close' }).click();
  }

  /** A rendered message matching this exact text (markdown wrapper classes
   * vary by content shape, so match on the rendered text itself). */
  message(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  citationLinks(): Locator {
    return this.page.locator('a[data-citation]');
  }

  async openSources() {
    await this.sourcesButton.click();
  }

  /** Open the Agent Panel popover (composer control, disabled outside research modes). */
  async openAgentPanel() {
    await this.panelButton.click();
  }

  /** The Agent Panel popover, scoped by its heading (shares ring/shadow classes
   * with the focus-mode popover, but only one is open at a time). */
  agentPanel(): Locator {
    return this.page
      .locator('div.ring-1.ring-surface-2')
      .filter({ hasText: 'Agent Panel' });
  }

  async toggleAgentPanelEnabled() {
    await this.agentPanel()
      .getByRole('switch', { name: 'Enable agent panel' })
      .click();
  }

  /** Add one executor model to the panel by its picker display name (e.g.
   * "Test (tool loop)"). The picker always shows "Select Model" since the
   * parent tracks the chosen executors, not this field's own selection. */
  async addPanelExecutor(displayName: string) {
    await this.agentPanel()
      .getByRole('button', { name: 'Select Model' })
      .click();
    const popover = this.page
      .locator('div.overflow-hidden.shadow-raised')
      .last();
    // The "Test" provider group's expanded state persists across executor
    // picks (it's the same ModelField instance) — only expand if collapsed,
    // since clicking an already-expanded header would re-collapse it.
    const model = popover.locator('span.font-medium', { hasText: displayName });
    if (!(await model.isVisible())) {
      await popover.getByText('Test', { exact: true }).click();
    }
    await model.click();
  }

  /** Enable the panel and select its executors in one call, then close the
   * popover so it doesn't cover the composer for subsequent interactions. */
  async configureAgentPanel(executorDisplayNames: string[]) {
    await this.openAgentPanel();
    await this.toggleAgentPanelEnabled();
    for (const name of executorDisplayNames) {
      await this.addPanelExecutor(name);
    }
    await this.page.keyboard.press('Escape');
  }

  /** Upload a document through the real attach flow (not a workspace-file seed). */
  async attachFile(name: string, content: string) {
    await this.attachInput.setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from(content, 'utf-8'),
    });
    await this.page
      .getByText(name, { exact: true })
      .waitFor({ state: 'visible', timeout: 15_000 });
  }
}
