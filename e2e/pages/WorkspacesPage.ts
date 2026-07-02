import { BasePage } from './BasePage';

export class WorkspacesPage extends BasePage {
  readonly heading = this.page.getByRole('heading', {
    name: 'Workspaces',
    exact: true,
  });

  private readonly newButton = this.page.getByRole('button', {
    name: 'New Workspace',
  });

  private readonly archiveToggle = this.page.getByRole('button', {
    name: /^(Archived|Active)$/,
  });

  /** The "N workspace(s)" subtitle; only rendered once the list query settles. */
  private readonly countSubtitle = this.page.locator(
    'span.text-sm.text-fg\\/50.shrink-0',
  );

  /** Wait until the workspace list has finished loading (isLoading === false). */
  private async waitLoaded() {
    await this.countSubtitle.waitFor({ state: 'visible', timeout: 15_000 });
  }

  async goto() {
    await super.goto('/workspaces');
    await this.heading.waitFor({ state: 'visible' });
    await this.waitLoaded();
  }

  /** Open the "New Workspace" modal. */
  async openCreateModal() {
    await this.newButton.click();
    await this.page
      .getByRole('heading', { name: 'New Workspace' })
      .waitFor({ state: 'visible' });
  }

  /** Fill name and submit the create-workspace modal. Returns the new workspace id from the URL. */
  async createWorkspace(name: string): Promise<string> {
    await this.openCreateModal();
    await this.page.getByRole('textbox', { name: 'Workspace name' }).fill(name);
    await this.page.getByRole('button', { name: 'Create' }).click();
    // After creation, navigates to /workspaces/[id]; extract id from URL.
    await this.page.waitForURL(/\/workspaces\/[^/?#]+/);
    await this.page
      .getByRole('heading', { name: 'Workspace settings' })
      .waitFor({ state: 'detached', timeout: 10_000 })
      .catch(() => {});
    const match = this.page.url().match(/\/workspaces\/([^/?#]+)/);
    return match?.[1] ?? '';
  }

  /** Toggle between Active and Archived view. */
  async toggleArchived() {
    await this.archiveToggle.click();
    // Wait for the list to refetch under the new filter and re-render.
    await this.page.waitForLoadState('networkidle');
    await this.waitLoaded();
  }

  /** Whether we are currently viewing the archived list. */
  async isShowingArchived(): Promise<boolean> {
    const text = await this.archiveToggle.textContent();
    return text?.trim() === 'Active'; // button says "Active" when showing archived
  }

  /** Read the "N workspace(s)" subtitle count. Returns -1 if unreadable. */
  async workspaceCount(): Promise<number> {
    const subtitle = this.page.locator('span.text-sm.text-fg\\/50.shrink-0');
    const text = await subtitle.textContent();
    if (!text) return -1;
    const match = text.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
  }

  /** Read all visible workspace card names. */
  async cardNames(): Promise<string[]> {
    const cards = this.page.locator('a[href^="/workspaces/"] span.font-medium');
    const names: string[] = [];
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const text = await cards.nth(i).textContent();
      if (text) names.push(text.trim());
    }
    return names;
  }

  /** Click a workspace card by name. */
  async openCard(name: string) {
    await this.page
      .locator('a[href^="/workspaces/"]', { hasText: name })
      .click();
    await this.page.waitForURL(/\/workspaces\/[^/?#]+/);
  }

  /** Locator for the desktop sidebar nav link that navigates here. */
  readonly sidebarLink = this.page.locator(
    'nav a[href="/workspaces"], .hidden.lg\\:fixed a[href="/workspaces"]',
  );
}
