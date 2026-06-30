import { BasePage } from './BasePage';

export class DashboardPage extends BasePage {
  readonly heading = this.page.getByRole('heading', {
    name: 'Dashboard',
    exact: true,
  });

  async goto() {
    await super.goto('/dashboard');
    await this.heading.waitFor({ state: 'visible' });
  }

  /** The empty-state card title (visible when no widgets exist). */
  readonly emptyTitle = this.page.getByText('Welcome to your Dashboard');
}
