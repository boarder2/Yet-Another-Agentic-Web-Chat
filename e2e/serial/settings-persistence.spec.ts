import { test, expect } from '../fixtures';

/**
 * Verify that DB-backed non-secret settings round-trip correctly:
 * UI toggle → localStorage → DB → survives page reload.
 *
 * We use `autoSuggestions` (Automation section toggle) because it's
 * a simple boolean, listed in MIGRATED_SETTING_KEYS, and no other test
 * depends on its specific value.
 */
// Both tests mutate the same global settings keys (autoSuggestions,
// memoryEnabled) — as does memory.spec.ts. This spec's `serial` project (one
// worker) keeps writers from racing against the single app_settings row.

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
});
