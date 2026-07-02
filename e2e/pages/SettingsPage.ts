import { BasePage } from './BasePage';

/**
 * Drives the settings UI via its modal form (the same SettingsPanel is also
 * reachable at the `/settings` page route). Opens the dialog by clicking the
 * settings button rendered on every page.
 */
export class SettingsPage extends BasePage {
  private readonly trigger = this.page.getByLabel('Settings');
  private readonly closeBtn = this.page.getByLabel('Close');

  async goto() {
    await super.goto('/');
    await this.trigger.first().click();
    await this.closeBtn.waitFor({ state: 'visible' });
  }

  async isOpen() {
    return this.closeBtn.isVisible();
  }

  async close() {
    await this.closeBtn.click();
  }

  /** Navigate to a section by its nav label (e.g. "Skills", "MCP Servers"). */
  async openSection(label: string) {
    await this.page
      .locator('nav.hidden.lg\\:block button')
      .filter({ hasText: label })
      .first()
      .click();
    await this.page
      .locator('h2.font-medium')
      .filter({ hasText: label })
      .first()
      .waitFor({ state: 'visible' });
  }
}
