import { test, expect } from '../fixtures';
import {
  seedArtifact,
  seedChat,
  seedWorkspace,
  runArtifactTurn,
} from '../utils/seed';

const DOC =
  '<!doctype html><html><head><title>Q3</title></head><body><h1 id="hd">Q3 Report</h1><p>Revenue was flat.</p></body></html>';

test.describe('artifact viewer', () => {
  test('the card reopens the panel after it is closed', async ({
    page,
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      title: 'Reopenable Report',
      content: DOC,
    });

    await page.goto(`/c/${chatId}`);

    const card = page.getByTestId('artifact-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Reopenable Report');
    // Browsing history must not auto-open the viewer.
    await expect(page.getByTestId('artifact-panel')).toBeHidden();

    await card.getByRole('button', { name: 'Open' }).click();
    const panel = page.getByTestId('artifact-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-artifact-id', artifactId);

    await panel.getByRole('button', { name: 'Close artifact panel' }).click();
    await expect(panel).toBeHidden();

    await card.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByTestId('artifact-panel')).toBeVisible();
  });

  test('artifact icon actions expose labels, href semantics, and danger tone', async ({
    page,
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      title: 'Icon action artifact',
      content: DOC,
    });
    const workspaceId = await seedWorkspace(request, {
      name: 'artifact-icon-actions-workspace',
    });
    const workspaceArtifact = await seedArtifact(request, {
      workspaceId,
      title: 'Delete icon artifact',
      content: DOC,
    });

    try {
      await page.goto(`/c/${chatId}`);
      await page
        .getByTestId('artifact-card')
        .getByRole('button', { name: 'Open' })
        .click();

      const panel = page.getByTestId('artifact-panel');
      for (const name of [
        'Close artifact panel',
        'Download artifact',
        'Open artifact in new tab',
      ]) {
        const action = panel.getByRole(
          name === 'Close artifact panel' ? 'button' : 'link',
          { name, exact: true },
        );
        await expect(action).toHaveAttribute('title', name);
        await expect(action).toHaveClass(/focus-border-neutral/);
        await expect(action.locator('svg')).toHaveAttribute('width', '15');
        await expect(action.locator('svg')).toHaveAttribute('height', '15');
      }
      await expect(
        panel.getByRole('link', { name: 'Download artifact' }),
      ).toHaveAttribute(
        'href',
        `/api/artifacts/${artifactId}/raw?version=1&download=1`,
      );
      await expect(
        panel.getByRole('link', { name: 'Open artifact in new tab' }),
      ).toHaveAttribute('href', `/api/artifacts/${artifactId}/raw?version=1`);

      await page.goto(
        `/workspaces/${workspaceId}/artifacts/${workspaceArtifact.artifactId}`,
      );
      const deleteAction = page.getByRole('button', {
        name: 'Delete artifact',
        exact: true,
      });
      await expect(deleteAction).toHaveAttribute('title', 'Delete artifact');
      await expect(deleteAction).toHaveClass(/focus-border-contrast/);
      await expect(deleteAction).toHaveClass(/text-danger/);
    } finally {
      const response = await request.delete(`/api/workspaces/${workspaceId}`);
      expect([200, 204, 404]).toContain(response.status());
      const chatResponse = await request.delete(`/api/chats/${chatId}`);
      expect([200, 204, 404]).toContain(chatResponse.status());
    }
  });

  test('single-artifact chat-scoped viewer panel', async ({
    page,
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      title: 'Solo Doc',
      content: DOC,
    });
    await page.goto(`/c/${chatId}`);
    await page
      .getByTestId('artifact-card')
      .getByRole('button', { name: 'Open' })
      .click();

    await test.step('the frame pins the sandbox that withholds same-origin access', async () => {
      const frame = page.getByTestId('artifact-frame');
      await expect(frame).toHaveAttribute(
        'sandbox',
        'allow-scripts allow-popups',
      );
      await expect(frame).toHaveAttribute(
        'src',
        `/api/artifacts/${artifactId}/raw?version=1`,
      );
    });

    await test.step('the artifact renders inside the frame', async () => {
      const frame = page.frameLocator('[data-testid="artifact-frame"]');
      await expect(frame.locator('#hd')).toHaveText('Q3 Report');
    });

    await test.step('a single-artifact chat shows the title instead of a selector', async () => {
      await expect(page.getByTestId('artifact-title')).toHaveText('Solo Doc');
      await expect(page.getByTestId('artifact-selector')).toBeHidden();
    });

    await test.step('the source view shows the artifact HTML read-only', async () => {
      await page.getByTestId('artifact-view-toggle').click();
      const source = page.getByTestId('artifact-source');
      await expect(source).toContainText('Revenue was flat.');
      await expect(source).toContainText('<!doctype html>');
      // Read-only: no editable control anywhere in the source view.
      await expect(
        source.locator('textarea, [contenteditable="true"]'),
      ).toHaveCount(0);
      await expect(page.getByTestId('artifact-frame')).toBeHidden();

      await page.getByTestId('artifact-view-toggle').click();
      await expect(page.getByTestId('artifact-frame')).toBeVisible();
    });
  });

  test('artifact JS stays off this origin even opened top-level', async ({
    page,
    request,
  }) => {
    // The panel offers "open in new tab", so the frame's sandbox attribute is
    // not the only way these bytes get loaded. The response's own `sandbox`
    // directive is what has to hold here — without it the document would run
    // same-origin and could read the local API and localStorage.
    const { artifactId } = await seedArtifact(request, {
      content: `<!doctype html><html><body><pre id="probe"></pre><script>
        const out = { origin: window.origin, storage: 'reachable' };
        try { localStorage.getItem('x'); } catch { out.storage = 'blocked'; }
        document.getElementById('probe').textContent = JSON.stringify(out);
      </script></body></html>`,
    });

    await page.goto(`/api/artifacts/${artifactId}/raw`);

    const probe = await page.locator('#probe').textContent();
    expect(JSON.parse(probe!)).toEqual({
      origin: 'null',
      storage: 'blocked',
    });
  });

  test('the chat chrome stays clear of the docked panel', async ({
    page,
    request,
  }) => {
    const { chatId } = await seedArtifact(request, { content: DOC });
    await page.goto(`/c/${chatId}`);
    await page
      .getByTestId('artifact-card')
      .getByRole('button', { name: 'Open' })
      .click();

    const panel = (await page.getByTestId('artifact-panel').boundingBox())!;
    // The pin/… cluster and the composer are both fixed to the viewport, so
    // nothing but this stops them being painted over the panel's own controls.
    for (const id of ['chat-actions', 'chat-input-bar']) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(
        box.x + box.width,
        `${id} overlaps the artifact panel`,
      ).toBeLessThanOrEqual(panel.x);
    }
  });

  test('workspace-docked artifact panel layout', async ({ page, request }) => {
    const workspaceId = await seedWorkspace(request);
    const chatId = await seedChat(request, { workspaceId });
    await seedArtifact(request, { chatId, content: DOC });

    await page.goto(`/workspaces/${workspaceId}/c/${chatId}`);
    const collapse = page.locator('button[title="Collapse sidebar"]');
    await expect(collapse).toBeVisible();

    await page
      .getByTestId('artifact-card')
      .getByRole('button', { name: 'Open' })
      .click();

    await test.step('the workspace header stays clear of the docked panel', async () => {
      const panel = (await page.getByTestId('artifact-panel').boundingBox())!;
      // The workspace breadcrumb bar spans the full content width, so the
      // panel has to be reserved out of the page rather than merely painted
      // over it.
      const header = (await page
        .locator('[data-sticky-header]')
        .boundingBox())!;
      expect(header.x + header.width).toBeLessThanOrEqual(panel.x);
    });

    await test.step('the workspace sidebar folds to its rail while the panel is docked', async () => {
      // Expanded, the sidebar would leave the chat too narrow to read, so it
      // collapses itself — and offers no expand button it couldn't honour.
      await expect(collapse).toBeHidden();
      await expect(page.locator('[data-workspace-section]')).toHaveCount(0);
      await expect(page.locator('button[title="Expand sidebar"]')).toBeHidden();
    });

    await test.step('the panel cannot be dragged past the composer', async () => {
      const handle = page.getByRole('separator', {
        name: 'Resize artifact panel',
      });
      const start = (await handle.boundingBox())!;
      const y = start.y + start.height / 2;
      await page.mouse.move(start.x + start.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(0, y, { steps: 10 });
      await page.mouse.up();

      // The widest the panel goes still has to leave the composer its own
      // row of controls — the send button spills out of the box otherwise.
      const bar = (await page.getByTestId('chat-input-bar').boundingBox())!;
      const send = (await page
        .locator('[data-testid="chat-input-bar"] button[type="submit"]')
        .boundingBox())!;
      expect(send.x + send.width).toBeLessThanOrEqual(bar.x + bar.width);
    });

    await test.step('the fold is presentation only: closing the panel restores the sidebar', async () => {
      await page
        .getByTestId('artifact-panel')
        .getByRole('button', { name: 'Close artifact panel' })
        .click();
      await expect(collapse).toBeVisible();
    });
  });

  test('the resize handle releases the drag over the frame', async ({
    page,
    request,
  }) => {
    const { chatId } = await seedArtifact(request, { content: DOC });
    await page.goto(`/c/${chatId}`);
    await page
      .getByTestId('artifact-card')
      .getByRole('button', { name: 'Open' })
      .click();

    const panel = page.getByTestId('artifact-panel');
    const handle = page.getByRole('separator', {
      name: 'Resize artifact panel',
    });
    const widthOf = async () => (await panel.boundingBox())!.width;

    const before = await widthOf();
    const start = (await handle.boundingBox())!;
    const y = start.y + start.height / 2;
    await page.mouse.move(start.x + start.width / 2, y);
    await page.mouse.down();
    // Narrowing drags the pointer across the artifact frame, which would
    // swallow the events without pointer capture.
    await page.mouse.move(start.x + 120, y, { steps: 10 });
    const dragged = await widthOf();
    expect(dragged).toBeLessThan(before);
    await page.mouse.up();

    // Pointer motion after release must no longer move the splitter.
    await page.mouse.move(start!.x + 300, y, { steps: 10 });
    expect(await widthOf()).toBe(dragged);
  });

  test('the version switcher browses earlier versions', async ({
    page,
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      content: DOC,
    });
    await runArtifactTurn(
      request,
      `${artifactId}|Revenue was flat.|Revenue grew 4%.`,
      { chatId, chatModel: 'test-artifact-edit' },
    );

    await page.goto(`/c/${chatId}`);
    // Each turn leaves its own card, and a card opens the version it announced.
    const cards = page.getByTestId('artifact-card');
    await expect(cards).toHaveCount(2);
    await cards.last().getByRole('button', { name: 'Open' }).click();

    const version = page.getByTestId('artifact-version');
    await expect(version).toHaveValue('2');
    await expect(
      page.frameLocator('[data-testid="artifact-frame"]').locator('p'),
    ).toHaveText('Revenue grew 4%.');

    await page.getByRole('button', { name: 'Previous version' }).click();
    await expect(version).toHaveValue('1');
    await expect(
      page.frameLocator('[data-testid="artifact-frame"]').locator('p'),
    ).toHaveText('Revenue was flat.');

    // Forward again, then the older card reopens at its own version.
    await page.getByRole('button', { name: 'Next version' }).click();
    await expect(version).toHaveValue('2');
    await cards.first().getByRole('button', { name: 'Open' }).click();
    await expect(version).toHaveValue('1');
  });

  test('a chat with two artifacts offers a selector', async ({
    page,
    request,
  }) => {
    const { chatId } = await seedArtifact(request, { title: 'First Doc' });
    await runArtifactTurn(request, `Second Doc|${DOC}`, { chatId });

    await page.goto(`/c/${chatId}`);
    await page
      .getByTestId('artifact-card')
      .first()
      .getByRole('button', { name: 'Open' })
      .click();

    const selector = page.getByTestId('artifact-selector');
    await expect(selector).toBeVisible();
    await expect(selector.locator('option')).toHaveCount(2);

    await selector.selectOption({ label: 'First Doc' });
    await expect(
      page.frameLocator('[data-testid="artifact-frame"]').locator('h1'),
    ).toHaveText('Seed');
  });

  test('on a narrow viewport the panel is a full-screen overlay', async ({
    page,
    request,
  }) => {
    const { chatId } = await seedArtifact(request, { content: DOC });
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(`/c/${chatId}`);
    await page
      .getByTestId('artifact-card')
      .getByRole('button', { name: 'Open' })
      .click();

    const panel = page.getByTestId('artifact-panel');
    await expect(panel).toBeVisible();
    // The desktop drag-width must not leak into the overlay and push the
    // header controls off-screen.
    const box = await panel.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
    await expect(
      panel.getByRole('button', { name: 'Close artifact panel' }),
    ).toBeInViewport();
  });
});
