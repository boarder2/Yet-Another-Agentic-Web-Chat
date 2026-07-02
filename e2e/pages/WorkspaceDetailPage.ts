import { BasePage } from './BasePage';

/**
 * Drives the workspace-detail view at `/workspaces/[id]`.
 *
 * On desktop (≥lg), the main area shows ChatsTab content while the
 * right-hand WorkspaceSidebar hosts Files/Sources/Instructions/Memory
 * collapsible sections plus a "Workspace settings" gear button that opens
 * the SettingsTab in a WorkspaceModal.
 */
export class WorkspaceDetailPage extends BasePage {
  /** The settings gear button in the WorkspaceSidebar (desktop). */
  private readonly settingsGear = this.page.locator(
    'button[title="Workspace settings"]',
  );

  /** The settings modal (WorkspaceModal). */
  private readonly settingsModal = this.page.locator(
    '.fixed.inset-0.z-50 [class*="rounded-floating"]',
  );

  async goto(id: string) {
    await super.goto(`/workspaces/${id}`);
    // Wait for the workspace shell to load (the header appears).
    await this.page
      .locator('h1, [class*="WorkspaceDetailHeader"]')
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 });
  }

  // ─── Settings modal (rename / archive / unarchive) ───

  async openSettings() {
    await this.settingsGear.first().click();
    await this.settingsModal.waitFor({ state: 'visible' });
  }

  async closeSettings() {
    await this.settingsModal
      .locator('button[aria-label="Close"]')
      .first()
      .click();
    await this.settingsModal.waitFor({ state: 'hidden' });
  }

  /** Rename the workspace via the settings modal. */
  async rename(newName: string) {
    await this.openSettings();
    // The SettingsTab has a name input (first text input in the modal).
    const nameInput = this.settingsModal.locator('input').first();
    await nameInput.fill(newName);
    await nameInput.blur();
    // Wait for the patch to settle.
    await this.page.waitForTimeout(500);
  }

  /** Archive the workspace via the settings modal. */
  async archive() {
    await this.openSettings();
    const btn = this.settingsModal.getByRole('button', { name: 'Archive' });
    await btn.click();
    await this.page.waitForTimeout(500);
  }

  /** Unarchive the workspace via the settings modal. */
  async unarchive() {
    await this.openSettings();
    const btn = this.settingsModal.getByRole('button', { name: 'Unarchive' });
    await btn.click();
    await this.page.waitForTimeout(500);
  }

  /** Get the workspace name as rendered in the detail header. */
  async headerName(): Promise<string> {
    // The WorkspaceDetailHeader renders an h1.
    const h1 = this.page.locator('h1').first();
    return ((await h1.textContent()) ?? '').trim();
  }

  // ─── Sidebar collapsible sections ───

  /** Expand a collapsible section by its title text. */
  async expandSection(title: string) {
    const sectionBtn = this.page.locator('section button', {
      hasText: title,
    });
    // If the section content is already visible, don't click again.
    const content = this.page.locator(
      `section:has(button:has-text("${title}")) > div:last-child`,
    );
    if (await content.isVisible()) return;
    await sectionBtn.click();
    await content.waitFor({ state: 'visible' });
  }

  // ─── Files ───

  /** Add a new text file via the Files section. */
  async addFile(name: string) {
    await this.expandSection('Files');
    // Click "New file"
    await this.page
      .locator('section:has(button:has-text("Files")) button', {
        hasText: 'New file',
      })
      .click();
    // The note-name input appears
    const nameInput = this.page.locator(
      'section:has(button:has-text("Files")) input[aria-label="Note name"]',
    );
    await nameInput.fill(name);
    // Click "Create"
    await this.page
      .locator('section:has(button:has-text("Files")) button', {
        hasText: 'Create',
      })
      .click();
    // After creating, there's no inline content dialog — the file is created empty.
    // Wait for the file to appear in the list.
    await this.page
      .locator(`section:has(button:has-text("Files")) li`, { hasText: name })
      .waitFor({ state: 'visible' });
  }

  /** Remove a file by name. Must handle the `window.confirm` dialog. */
  async removeFile(name: string) {
    await this.expandSection('Files');
    const row = this.page.locator(
      `section:has(button:has-text("Files")) li:has-text("${name}")`,
    );
    const delBtn = row.locator('button[title="Delete"]');
    this.page.once('dialog', (d) => d.accept());
    await delBtn.click();
    await row.waitFor({ state: 'hidden' });
  }

  /** Get the visible file names in the sidebar Files list. */
  async fileNames(): Promise<string[]> {
    await this.expandSection('Files');
    const items = this.page.locator(
      'section:has(button:has-text("Files")) li span.truncate',
    );
    const names: string[] = [];
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent();
      if (text) names.push(text.trim());
    }
    return names;
  }

  // ─── Sources / URLs ───

  /** Add a URL via the Sources section. */
  async addUrl(url: string) {
    await this.expandSection('Sources');
    const input = this.page.locator(
      'section:has(button:has-text("Sources")) input[aria-label="URL"]',
    );
    await input.fill(url);
    await this.page
      .locator('section:has(button:has-text("Sources")) button', {
        hasText: 'Add',
      })
      .click();
    // Wait for the URL to appear in the list.
    await this.page
      .locator(`section:has(button:has-text("Sources")) a[href="${url}"]`)
      .waitFor({ state: 'visible', timeout: 10_000 });
  }

  /** Remove a URL by value. */
  async removeUrl(url: string) {
    await this.expandSection('Sources');
    const row = this.page.locator(
      `section:has(button:has-text("Sources")) li:has(a[href="${url}"])`,
    );
    const delBtn = row.locator('button[title="Remove"]');
    await delBtn.click();
    await row.waitFor({ state: 'hidden' });
  }

  /** Get the visible URLs in the sidebar Sources list. */
  async urlValues(): Promise<string[]> {
    await this.expandSection('Sources');
    const links = this.page.locator(
      'section:has(button:has-text("Sources")) li a[href^="http"]',
    );
    const urls: string[] = [];
    const count = await links.count();
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute('href');
      if (href) urls.push(href);
    }
    return urls;
  }
}
