import { BasePage } from './BasePage';

export class HomePage extends BasePage {
  readonly input = this.page.locator('#message-input');
  readonly submit = this.page.locator('button[type="submit"]');

  async goto() {
    await super.goto('/');
    await this.input.waitFor({ state: 'visible' });
  }

  async sendMessage(text: string) {
    await this.input.fill(text);
    await this.submit.click();
  }
}
