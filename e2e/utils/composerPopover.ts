import type { Locator, Page } from '@playwright/test';
import { expect } from '../fixtures';

const COMPOSER_POPOVER_SELECTOR = '[data-composer-popover="true"]';

export function composerPopover(page: Page, title: string): Locator {
  return page.locator(COMPOSER_POPOVER_SELECTOR).filter({ hasText: title });
}

export async function expectComposerPopover(
  page: Page,
  title: string,
): Promise<Locator> {
  const shell = composerPopover(page, title);
  await expect(shell).toBeVisible();
  await expect(
    shell.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  for (const token of [
    'bg-surface',
    'border',
    'border-surface-2',
    'rounded-floating',
    'shadow-floating',
  ]) {
    await expect(shell).toHaveClass(new RegExp(`(^|\\s)${token}(\\s|$)`));
  }
  await expect(shell).not.toHaveClass(/(^|\s)shadow-raised(\s|$)/);
  await expect(shell).not.toHaveClass(/(^|\s)ring-1(\s|$)/);
  return shell;
}
