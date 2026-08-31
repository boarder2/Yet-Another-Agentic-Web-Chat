import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { SettingsPage } from '../pages/SettingsPage';

const settingKey = 'codeExecutionAutoRun';

async function setAutoRun(page: Page, value: boolean | null) {
  const response = await page.request.patch('/api/settings', {
    data: { [settingKey]: value === null ? null : String(value) },
  });
  expect(response.status()).toBe(204);
}

async function mockCodeExecutionAvailable(page: Page) {
  const response = await page.request.get('/api/config');
  expect(response.status()).toBe(200);
  const config = await response.json();
  config.codeExecution = { enabled: true };
  await page.route('**/api/config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, json: config });
    } else {
      await route.continue();
    }
  });
}

async function openAutomation(page: Page) {
  const settings = new SettingsPage(page);
  await settings.goto();
  await settings.openSection('Automation');
  return page.getByRole('switch', { name: 'Auto-run generated code' });
}

async function storedValue(page: Page) {
  const response = await page.request.get('/api/settings');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as Record<string, string>;
  return body[settingKey];
}

test.describe('code execution auto-run setting', () => {
  test.afterEach(async ({ page }) => {
    await setAutoRun(page, null);
  });

  test('retains the stored state but disables the control when code execution is unavailable', async ({
    page,
  }) => {
    await setAutoRun(page, true);
    const toggle = await openAutomation(page);

    await expect(toggle).toBeChecked();
    await expect(toggle).toBeDisabled();
    await expect(
      page.getByText(
        'Unavailable because code execution is not enabled by the operator. Your saved preference is retained.',
      ),
    ).toBeVisible();
  });

  test('requires confirmation on every enable, persists both transitions, and does not accept the manual warning', async ({
    page,
  }) => {
    await setAutoRun(page, false);
    await mockCodeExecutionAvailable(page);
    const toggle = await openAutomation(page);

    await expect(toggle).not.toBeChecked();
    await toggle.click();
    const confirmation = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: /Auto-run Code/ }) });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => storedValue(page)).toBe('false');

    await toggle.click();
    await confirmation.getByRole('button', { name: /Enable auto-run/ }).click();
    await expect(confirmation).toBeHidden();
    await expect(toggle).toBeChecked();
    await expect.poll(() => storedValue(page)).toBe('true');
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem('codeExecutionWarningAccepted'),
        ),
      )
      .toBeNull();

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => storedValue(page)).toBe('false');

    await toggle.click();
    await expect(confirmation).toBeVisible();
  });

  test('rolls back a failed disable to the last durable state', async ({
    page,
  }) => {
    await setAutoRun(page, true);
    await mockCodeExecutionAvailable(page);
    let failNextPatch = true;
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'PATCH' && failNextPatch) {
        failNextPatch = false;
        await route.fulfill({ status: 500, body: 'save failed' });
      } else {
        await route.continue();
      }
    });
    const toggle = await openAutomation(page);

    await expect(toggle).toBeChecked();
    await toggle.click();

    await expect(
      page.getByText('Could not save the auto-run setting. Try again.'),
    ).toBeVisible();
    await expect(toggle).toBeChecked();
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem('codeExecutionAutoRun')),
      )
      .toBe('true');
    await expect.poll(() => storedValue(page)).toBe('true');
  });

  test('rolls back a failed enable and allows retry from the confirmation', async ({
    page,
  }) => {
    await setAutoRun(page, false);
    await mockCodeExecutionAvailable(page);
    let failNextPatch = true;
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'PATCH' && failNextPatch) {
        failNextPatch = false;
        await route.fulfill({ status: 500, body: 'save failed' });
      } else {
        await route.continue();
      }
    });
    const toggle = await openAutomation(page);

    await toggle.click();
    const confirmation = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: /Auto-run Code/ }) });
    const enable = confirmation.getByRole('button', {
      name: /Enable auto-run/,
    });
    await enable.click();

    await expect(confirmation.getByRole('alert')).toHaveText(
      'Could not save the auto-run setting. Try again.',
    );
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem('codeExecutionAutoRun')),
      )
      .toBe('false');
    await expect.poll(() => storedValue(page)).toBe('false');

    await enable.click();
    await expect(confirmation).toBeHidden();
    await expect(toggle).toBeChecked();
    await expect.poll(() => storedValue(page)).toBe('true');
  });
});
