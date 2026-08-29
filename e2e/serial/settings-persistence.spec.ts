import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { SettingsPage } from '../pages/SettingsPage';

async function enableOpenRouterInConfig(page: Page) {
  const response = await page.request.get('/api/config');
  const body = await response.json();
  body.chatModelProviders ??= {};
  body.chatModelProviders.openrouter = [
    { name: 'test/openrouter', displayName: 'Test OpenRouter' },
  ];

  await page.route('**/api/config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, json: body });
    } else {
      await route.continue();
    }
  });
}

/**
 * Verify that DB-backed non-secret settings round-trip correctly:
 * UI toggle → localStorage → DB → survives page reload.
 *
 * We use `autoSuggestions` (Automation section toggle) because it's
 * a simple boolean, listed in MIGRATED_SETTING_KEYS, and no other test
 * depends on its specific value.
 */
// These tests mutate global settings keys (autoSuggestions, memoryEnabled,
// and openrouterQuantizations) — as does memory.spec.ts. This spec's `serial`
// project (one worker) keeps writers from racing against the single app_settings
// row.

test.describe('settings persistence', () => {
  test('autoSuggestions toggle persists through localStorage and page reload', async ({
    page,
  }) => {
    // 1. Open the Settings modal and navigate to "Automation".
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Settings').first().click();
    await page.getByLabel('Close').waitFor({ state: 'visible' });

    await page
      .locator('nav.hidden.lg\\:block button')
      .filter({ hasText: 'Automation' })
      .first()
      .click();

    // Wait for the section to render.
    await page
      .locator('h2.font-medium')
      .filter({ hasText: 'Automation' })
      .first()
      .waitFor({ state: 'visible' });

    // 2. Find the AppSwitch for Automatic Suggestions and toggle it off.
    // Scoped to the dialog: the composer's agent-panel toggle is also a
    // `button[role="switch"]` and appears earlier in the DOM.
    const toggle = page
      .getByRole('dialog')
      .locator('button[role="switch"]')
      .first();
    const initiallyChecked = (await toggle.getAttribute('data-checked')) === '';

    // Toggle to the opposite state.
    await toggle.click();

    const expectedState = !initiallyChecked;
    await expect
      .poll(() => toggle.getAttribute('data-checked'))
      .toBe(expectedState ? '' : null);

    // 3. Assert localStorage was written. The persist layer debounces (~400ms),
    // so poll rather than reading once at a fixed delay.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('autoSuggestions')))
      .toBe(String(expectedState));

    // 4. Assert the server reflects the change (settings are synced to DB).
    // The flush delay is 400ms; poll rather than a fixed wait. `/api/settings`
    // returns the serialized-string map (same shape as the localStorage cache),
    // so the boolean is stored as the string "true"/"false".
    let apiBody: Record<string, unknown> = {};
    await expect
      .poll(async () => {
        const res = await page.request.get('/api/settings');
        expect(res.status()).toBe(200);
        apiBody = await res.json();
        return apiBody.autoSuggestions;
      })
      .toBe(String(expectedState));
    expect(apiBody).toHaveProperty('autoSuggestions');

    // 5. Reload the page: localStorage should hydrate from DB and match.
    await page.reload({ waitUntil: 'networkidle' });
    const lsAfterReload = await page.evaluate(() =>
      localStorage.getItem('autoSuggestions'),
    );
    expect(lsAfterReload).toBe(String(expectedState));

    // 6. Re-open settings and verify the toggle still reflects the persisted value.
    await page.getByLabel('Settings').first().click();
    await page.getByLabel('Close').waitFor({ state: 'visible' });

    await page
      .locator('nav.hidden.lg\\:block button')
      .filter({ hasText: 'Automation' })
      .first()
      .click();

    await page
      .locator('h2.font-medium')
      .filter({ hasText: 'Automation' })
      .first()
      .waitFor({ state: 'visible' });

    const toggleAfterReload = page
      .getByRole('dialog')
      .locator('button[role="switch"]')
      .first();
    const reloadChecked =
      (await toggleAfterReload.getAttribute('data-checked')) === '';
    expect(reloadChecked).toBe(expectedState);
  });

  test('multiple settings persist independently via API PATCH and survive reload', async ({
    page,
    request,
  }) => {
    // Patch two settings to known non-default values via the PATCH API.
    // This exercises the multi-key upsert path in the settings route (the
    // for-each loop over Object.entries of the body).
    const patchBody = {
      autoSuggestions: 'false',
      memoryEnabled: 'true',
    };
    const patchRes = await request.patch('/api/settings', {
      data: patchBody,
    });
    expect(patchRes.status()).toBe(204);

    // Load the app so it hydrates localStorage from the DB.
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Both settings should now be in localStorage with the patched values.
    const lsAuto = await page.evaluate(() =>
      localStorage.getItem('autoSuggestions'),
    );
    const lsMem = await page.evaluate(() =>
      localStorage.getItem('memoryEnabled'),
    );
    expect(lsAuto).toBe('false');
    expect(lsMem).toBe('true');

    // Verify the API GET returns both changed values.
    const apiRes = await request.get('/api/settings');
    expect(apiRes.status()).toBe(200);
    const apiBody = await apiRes.json();
    expect(apiBody.autoSuggestions).toBe('false');
    expect(apiBody.memoryEnabled).toBe('true');

    // After a reload, localStorage must still hold both values (DB is
    // source-of-truth, and the client hydration re-populates localStorage).
    await page.reload({ waitUntil: 'networkidle' });
    const lsAuto2 = await page.evaluate(() =>
      localStorage.getItem('autoSuggestions'),
    );
    const lsMem2 = await page.evaluate(() =>
      localStorage.getItem('memoryEnabled'),
    );
    expect(lsAuto2).toBe('false');
    expect(lsMem2).toBe('true');
  });

  test('hides OpenRouter quantization settings when the provider is unavailable', async ({
    page,
  }) => {
    const settings = new SettingsPage(page);
    await settings.goto();
    await settings.openSection('Model Settings');

    await expect(
      page.getByRole('group', {
        name: 'Allowed endpoint quantizations',
        exact: true,
      }),
    ).toHaveCount(0);
  });

  test('OpenRouter quantization checklist saves before showing applied, hydrates on reload, and restores default routing', async ({
    page,
    request,
  }) => {
    const key = 'openrouterQuantizations';
    const before = await (await request.get('/api/settings')).json();
    const original = before[key];
    let releasePatch = () => {};

    try {
      // Start from the default so the checklist assertions are independent of
      // any earlier serial test attempt.
      const resetRes = await request.patch('/api/settings', {
        data: { [key]: null },
      });
      expect(resetRes.status()).toBe(204);

      await enableOpenRouterInConfig(page);
      const settings = new SettingsPage(page);
      await settings.goto();
      await settings.openSection('Model Settings');
      const dialog = page.getByRole('dialog');
      const integerGroup = dialog.getByRole('group', {
        name: 'Integer',
        exact: true,
      });
      const floatingPointGroup = dialog.getByRole('group', {
        name: 'Floating point',
        exact: true,
      });
      await expect(
        dialog.getByRole('group', {
          name: 'Allowed endpoint quantizations',
          exact: true,
        }),
      ).toBeVisible();
      await expect(integerGroup).toBeVisible();
      await expect(floatingPointGroup).toBeVisible();

      for (const label of [
        'INT4',
        'INT8',
        'FP4',
        'MXFP4',
        'NVFP4',
        'FP6',
        'FP8',
        'MXFP8',
        'FP16',
        'BF16',
        'FP32',
      ]) {
        await expect(
          dialog.getByRole('checkbox', { name: label, exact: true }),
        ).toHaveCount(1);
      }
      await expect(dialog).toContainText('default routing');
      await expect(dialog).toContainText('model catalog is not filtered');
      await expect(dialog).toContainText('reduce availability');
      await expect(dialog).toContainText('response quality');
      await expect(dialog).toContainText(
        'Image generation uses a separate OpenRouter integration',
      );

      const int4 = dialog.getByRole('checkbox', {
        name: 'INT4',
        exact: true,
      });
      const fp8 = dialog.getByRole('checkbox', { name: 'FP8', exact: true });
      await expect(int4).not.toBeChecked();
      await expect(fp8).not.toBeChecked();

      // Hold the first PATCH open: localStorage updates immediately, but the
      // UI must not report "Saved" until the DB write has completed.
      let patchStarted = () => {};
      const patchStartedPromise = new Promise<void>((resolve) => {
        patchStarted = resolve;
      });
      const patchGate = new Promise<void>((resolve) => {
        releasePatch = resolve;
      });
      await page.route('**/api/settings', async (route) => {
        if (route.request().method() === 'PATCH') {
          let body: unknown;
          try {
            body = route.request().postDataJSON();
          } catch {
            body = null;
          }
          if (
            typeof body === 'object' &&
            body !== null &&
            Object.prototype.hasOwnProperty.call(body, key)
          ) {
            patchStarted();
            await patchGate;
            await route.continue();
            return;
          }
        }
        await route.continue();
      });

      await int4.check();
      await patchStartedPromise;
      await expect(dialog.getByText('Saving…', { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate((settingKey) => localStorage.getItem(settingKey), key),
        )
        .toBe('["int4"]');
      await expect(dialog.getByText('Saved', { exact: true })).toHaveCount(0);

      releasePatch();
      await expect(dialog.getByText('Saved', { exact: true })).toBeVisible();
      await page.unroute('**/api/settings');
      const firstSelectionInDb = await (
        await request.get('/api/settings')
      ).json();
      expect(firstSelectionInDb[key]).toBe('["int4"]');

      await fp8.check();
      await expect(fp8).toBeChecked();
      await expect
        .poll(() =>
          page.evaluate((settingKey) => localStorage.getItem(settingKey), key),
        )
        .toBe('["int4","fp8"]');
      await expect(dialog.getByText('Saved', { exact: true })).toBeVisible();

      const selectedInDb = await (await request.get('/api/settings')).json();
      expect(selectedInDb[key]).toBe('["int4","fp8"]');

      // A fresh page gets the persisted canonical selection through the normal
      // localStorage ⇄ DB hydration path.
      await page.reload({ waitUntil: 'networkidle' });
      await expect
        .poll(() =>
          page.evaluate((settingKey) => localStorage.getItem(settingKey), key),
        )
        .toBe('["int4","fp8"]');
      const reloadedSettings = new SettingsPage(page);
      await reloadedSettings.goto();
      await reloadedSettings.openSection('Model Settings');
      const reloadedDialog = page.getByRole('dialog');
      const reloadedInt4 = reloadedDialog.getByRole('checkbox', {
        name: 'INT4',
        exact: true,
      });
      const reloadedFp8 = reloadedDialog.getByRole('checkbox', {
        name: 'FP8',
        exact: true,
      });
      await expect(reloadedInt4).toBeChecked();
      await expect(reloadedFp8).toBeChecked();

      // Empty selection is represented by deletion, returning to default
      // unrestricted routing rather than persisting an empty array.
      await reloadedInt4.uncheck();
      await expect(
        reloadedDialog.getByText('Saved', { exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate((settingKey) => localStorage.getItem(settingKey), key),
        )
        .toBe('["fp8"]');
      await reloadedFp8.uncheck();
      await expect
        .poll(() =>
          page.evaluate((settingKey) => localStorage.getItem(settingKey), key),
        )
        .toBeNull();
      await expect(
        reloadedDialog.getByText('Saved', { exact: true }),
      ).toBeVisible();

      const defaultedInDb = await (await request.get('/api/settings')).json();
      expect(defaultedInDb[key]).toBeUndefined();
    } finally {
      releasePatch();
      await page.unroute('**/api/settings');
      const restoreRes = await request.patch('/api/settings', {
        data: { [key]: original ?? null },
      });
      expect(restoreRes.status()).toBe(204);
    }
  });

  test('shows an OpenRouter quantization save failure and allows retry', async ({
    page,
    request,
  }) => {
    const key = 'openrouterQuantizations';
    const before = await (await request.get('/api/settings')).json();
    const original = before[key];
    let quantizationPatchAttempts = 0;

    try {
      const resetRes = await request.patch('/api/settings', {
        data: { [key]: null },
      });
      expect(resetRes.status()).toBe(204);

      await enableOpenRouterInConfig(page);
      const settings = new SettingsPage(page);
      await settings.goto();
      await settings.openSection('Model Settings');
      const dialog = page.getByRole('dialog');

      await page.route('**/api/settings', async (route) => {
        if (route.request().method() === 'PATCH') {
          let body: unknown;
          try {
            body = route.request().postDataJSON();
          } catch {
            body = null;
          }
          if (
            typeof body === 'object' &&
            body !== null &&
            Object.prototype.hasOwnProperty.call(body, key)
          ) {
            quantizationPatchAttempts += 1;
            if (quantizationPatchAttempts === 1) {
              await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'forced test failure' }),
              });
              return;
            }
          }
        }
        await route.continue();
      });

      await dialog.getByRole('checkbox', { name: 'FP8', exact: true }).check();
      await expect(
        dialog.getByText('Not saved', { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText(
          'Failed to save OpenRouter quantization settings. Try again.',
          { exact: true },
        ),
      ).toBeVisible();

      const retry = dialog.getByRole('button', {
        name: 'Retry save',
        exact: true,
      });
      await expect(retry).toBeVisible();
      await retry.click();
      await expect(dialog.getByText('Saved', { exact: true })).toBeVisible();
      expect(quantizationPatchAttempts).toBe(2);

      const savedInDb = await (await request.get('/api/settings')).json();
      expect(savedInDb[key]).toBe('["fp8"]');
    } finally {
      await page.unroute('**/api/settings');
      const restoreRes = await request.patch('/api/settings', {
        data: { [key]: original ?? null },
      });
      expect(restoreRes.status()).toBe(204);
    }
  });

  test('recovers from malformed hydrated OpenRouter quantization state', async ({
    page,
    request,
  }) => {
    const key = 'openrouterQuantizations';
    const before = await (await request.get('/api/settings')).json();
    const original = before[key];

    try {
      const resetRes = await request.patch('/api/settings', {
        data: { [key]: null },
      });
      expect(resetRes.status()).toBe(204);

      // Seed the malformed cache before the app installs its persistence
      // wrapper. Hydration cannot silently sanitize or overwrite it from the
      // empty server value, so the settings screen must expose recovery.
      await page.addInitScript(
        ({ settingKey }) => {
          localStorage.setItem(settingKey, '["unknown"]');
        },
        { settingKey: key },
      );

      await enableOpenRouterInConfig(page);
      const settings = new SettingsPage(page);
      await settings.goto();
      await settings.openSection('Model Settings');
      const dialog = page.getByRole('dialog');

      await expect(
        dialog.getByText(/Stored setting is invalid:/),
      ).toBeVisible();
      await expect(
        dialog.getByText(
          'Choose a supported value to replace it, or reset to default.',
          { exact: true },
        ),
      ).toBeVisible();
      const reset = dialog.getByRole('button', {
        name: 'Reset to default',
        exact: true,
      });
      await expect(reset).toBeVisible();

      await reset.click();
      await expect(dialog.getByText('Saved', { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate((settingKey) => localStorage.getItem(settingKey), key),
        )
        .toBeNull();

      const recovered = await (await request.get('/api/settings')).json();
      expect(recovered[key]).toBeUndefined();
    } finally {
      const restoreRes = await request.patch('/api/settings', {
        data: { [key]: original ?? null },
      });
      expect(restoreRes.status()).toBe(204);
    }
  });
});
