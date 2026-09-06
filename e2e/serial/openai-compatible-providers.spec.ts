import http, { type IncomingHttpHeaders } from 'node:http';

import { test, expect } from '../fixtures';
import { expectComposerPopover } from '../utils/composerPopover';
import { SettingsPage } from '../pages/SettingsPage';

test.describe.configure({ mode: 'serial' });

type UpstreamRequest = { headers: IncomingHttpHeaders };

let upstream: http.Server;
let upstreamPort: number;
const upstreamRequests: UpstreamRequest[] = [];
let createdProviderId: string | null = null;

function upstreamBaseUrl(): string {
  return `http://127.0.0.1:${upstreamPort}`;
}

test.beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/v1/models') {
      res.writeHead(404).end();
      return;
    }

    upstreamRequests.push({ headers: req.headers });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        data: [{ id: 'ui-model', name: 'Discovered UI Model' }],
      }),
    );
  });

  await new Promise<void>((resolve) => {
    upstream.listen(0, '127.0.0.1', () => {
      const address = upstream.address();
      if (!address || typeof address === 'string') {
        throw new Error('upstream server did not expose a TCP address');
      }
      upstreamPort = address.port;
      resolve();
    });
  });
});

test.afterEach(async ({ page, request }) => {
  if (createdProviderId) {
    await request.delete(
      `/api/providers/openai-compatible/${createdProviderId}`,
    );
    createdProviderId = null;
  }

  // Restore the seeded model selection so this instance-wide serial workflow
  // cannot leave a stale dynamic reference for the following spec.
  await page.evaluate(() => {
    localStorage.setItem('chatModelProvider', 'test');
    localStorage.setItem('chatModel', 'test-direct');
    localStorage.setItem('systemModelProvider', 'test');
    localStorage.setItem('systemModel', 'test-direct');
  });
  await page.waitForTimeout(500);
  await request.patch('/api/settings', {
    data: {
      chatModelProvider: 'test',
      chatModel: 'test-direct',
      systemModelProvider: 'test',
      systemModel: 'test-direct',
    },
  });
  upstreamRequests.length = 0;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    upstream.close((error) => (error ? reject(error) : resolve()));
  });
});

test('manages a compatible provider and keeps dynamic selections explicitly stale', async ({
  page,
  request,
}) => {
  const initialName = `UI Gateway ${Date.now()}`;
  const renamedName = `${initialName} Renamed`;
  const secret = 'Bearer ui-only-secret';
  const settings = new SettingsPage(page);

  await settings.goto();
  await page.waitForLoadState('networkidle');
  await settings.openSection('OpenAI-Compatible Providers');

  await page
    .getByRole('button', { name: 'Add provider', exact: true })
    .first()
    .click();
  const addDialog = page.getByRole('dialog').last();
  const addHeading = addDialog.getByRole('heading', {
    name: 'Add OpenAI-Compatible Provider',
    exact: true,
  });
  await expect(addHeading).toBeVisible();
  await addDialog.getByLabel('Name').fill(initialName);
  await addDialog.getByLabel('Base URL').fill(upstreamBaseUrl());

  await addDialog
    .getByRole('switch', { name: 'Supports Embeddings', exact: true })
    .click();
  await addDialog
    .getByRole('button', { name: 'Add Bearer Token', exact: true })
    .click();
  const headerName = addDialog.getByLabel('Header 1 name');
  const headerValue = addDialog.getByLabel('Header 1 value');
  await expect(headerName).toHaveValue('Authorization');
  await expect(headerValue).toBeFocused();
  await headerValue.fill(secret);

  const createResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' &&
      url.pathname === '/api/providers/openai-compatible'
    );
  });
  await addDialog
    .getByRole('button', { name: 'Add provider', exact: true })
    .click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  createdProviderId = (
    (await createResponse.json()) as { provider: { id: string } }
  ).provider.id;
  await expect(addHeading).toBeHidden();

  const providerRow = page
    .locator('[data-list-row]')
    .filter({ hasText: initialName });
  await expect(providerRow).toBeVisible();
  await expect(providerRow).toContainText(`${upstreamBaseUrl()}/v1`);
  await expect(providerRow).toContainText('Enabled');
  await expect(providerRow).toContainText('Embeddings');
  await expect(providerRow).toContainText('1 header');
  await expect(page.locator('body')).not.toContainText(secret);

  // The mutation invalidates the model/config queries without a page reload,
  // and the catalog exposes the provider's display name and discovered model.
  await settings.close();
  await expect(
    page.getByRole('button', { name: 'Configure models', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Configure models', exact: true })
    .click();
  const modelDialog = page.getByRole('dialog').last();
  await expect(
    modelDialog.getByRole('heading', {
      name: 'Model Configuration',
      exact: true,
    }),
  ).toBeVisible();
  const chatFieldButton = modelDialog
    .locator('button:has(svg.lucide-cpu)')
    .first();
  await chatFieldButton.click();
  const chatPopover = await expectComposerPopover(page, 'Select Chat Model');
  const providerButton = chatPopover.getByRole('button', {
    name: new RegExp(initialName),
  });
  await expect(providerButton).toBeVisible();
  await providerButton.click();
  await expect(
    chatPopover.getByRole('button', {
      name: 'Discovered UI Model',
      exact: true,
    }),
  ).toBeVisible();
  await chatPopover
    .getByRole('button', { name: 'Discovered UI Model', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        provider: localStorage.getItem('chatModelProvider'),
        model: localStorage.getItem('chatModel'),
      })),
    )
    .toEqual({
      provider: `openai-compatible:${createdProviderId}`,
      model: 'ui-model',
    });
  await modelDialog.locator('button').filter({ hasText: 'Close' }).click();
  await expect(modelDialog).toBeHidden();

  // Edit shows write-only headers as blank and keeps the stored value when
  // the user leaves it unchanged.
  await page.getByLabel('Settings').first().click();
  await page.getByLabel('Close').waitFor({ state: 'visible' });
  await settings.openSection('OpenAI-Compatible Providers');
  await providerRow.getByRole('button', { name: 'Edit' }).click();
  const editDialog = page.getByRole('dialog').last();
  await expect(
    editDialog.getByRole('heading', {
      name: 'Edit OpenAI-Compatible Provider',
      exact: true,
    }),
  ).toBeVisible();
  const editHeaderValue = editDialog.getByLabel('Header 1 value');
  await expect(editHeaderValue).toHaveValue('');
  await expect(editHeaderValue).toHaveAttribute('placeholder', 'Unchanged');
  await editDialog.getByLabel('Name', { exact: true }).fill(renamedName);

  const patchResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === 'PATCH' &&
      response
        .url()
        .endsWith(`/api/providers/openai-compatible/${createdProviderId}`)
    );
  });
  await editDialog
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  const patchResponse = await patchResponsePromise;
  expect(patchResponse.status()).toBe(200);
  await expect(
    editDialog.getByRole('heading', {
      name: 'Edit OpenAI-Compatible Provider',
      exact: true,
    }),
  ).toBeHidden();

  const renamedRow = page
    .locator('[data-list-row]')
    .filter({ hasText: renamedName });
  await expect(renamedRow).toBeVisible();
  await expect(renamedRow).toContainText('1 header');
  await expect(page.locator('body')).not.toContainText(secret);

  const disableResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === 'PATCH' &&
      response
        .url()
        .endsWith(`/api/providers/openai-compatible/${createdProviderId}`)
    );
  });
  await renamedRow.getByRole('switch').click();
  const disableResponse = await disableResponsePromise;
  expect(disableResponse.status()).toBe(200);
  await expect(renamedRow).toContainText('Disabled');
  await expect(renamedRow.getByRole('switch')).toHaveAttribute(
    'aria-checked',
    'false',
  );

  // Test intentionally bypasses enabled filtering and still uses the
  // preserved secret header.
  upstreamRequests.length = 0;
  const testResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === 'POST' &&
      response
        .url()
        .endsWith(`/api/providers/openai-compatible/${createdProviderId}/test`)
    );
  });
  await renamedRow.getByRole('button', { name: 'Test' }).click();
  const testResponse = await testResponsePromise;
  expect(testResponse.status()).toBe(200);
  await expect(renamedRow.getByRole('status')).toHaveText(
    'Test successful — 1 model discovered.',
  );
  expect(upstreamRequests).toHaveLength(1);
  expect(upstreamRequests[0].headers.authorization).toBe(secret);

  // Disabling removes the dynamic catalog entry but does not rewrite the
  // explicit chat selection; the picker must surface it as unavailable.
  await settings.close();
  await page
    .getByRole('button', { name: 'Configure models', exact: true })
    .click();
  const staleModelDialog = page.getByRole('dialog').last();
  const staleChatButton = staleModelDialog
    .locator('button:has(svg.lucide-cpu)')
    .first();
  await expect(staleChatButton).toContainText('Unavailable');
  await staleChatButton.click();
  const stalePopover = await expectComposerPopover(page, 'Select Chat Model');
  await expect(
    stalePopover.getByText('Unavailable', { exact: true }),
  ).toBeVisible();
  await expect(stalePopover).toContainText(`ui-model · ${renamedName}`);
  await expect(
    stalePopover.getByRole('button', { name: 'Open settings', exact: true }),
  ).toBeVisible();
  await staleModelDialog.locator('button').filter({ hasText: 'Close' }).click();
  await expect(staleModelDialog).toBeHidden();

  await page.getByLabel('Settings').first().click();
  await page.getByLabel('Close').waitFor({ state: 'visible' });
  await settings.openSection('OpenAI-Compatible Providers');
  const currentRow = page
    .locator('[data-list-row]')
    .filter({ hasText: renamedName });
  await currentRow.getByRole('button', { name: 'Delete' }).click();
  const confirmation = page.getByRole('dialog').last();
  await expect(
    confirmation.getByRole('heading', {
      name: 'Delete OpenAI-compatible provider',
      exact: true,
    }),
  ).toBeVisible();
  await expect(confirmation).toContainText(
    'Saved model references will remain after deletion and may be unavailable',
  );

  const deleteResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === 'DELETE' &&
      response
        .url()
        .endsWith(`/api/providers/openai-compatible/${createdProviderId}`)
    );
  });
  await confirmation
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(200);
  createdProviderId = null;
  await expect(currentRow).toHaveCount(0);
  await expect(
    page.getByText('No OpenAI-compatible providers configured yet.'),
  ).toBeVisible();

  const listed = await (
    await request.get('/api/providers/openai-compatible')
  ).json();
  expect(listed.providers).toEqual([]);
});
