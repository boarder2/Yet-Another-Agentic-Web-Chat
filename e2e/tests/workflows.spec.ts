import { test, expect } from '../fixtures';
import { seedWorkflow } from '../utils/seed';
import { uniq } from '../utils/helpers';

function workflowRow<T extends { locator: (selector: string) => unknown }>(
  page: T,
  id: string,
): ReturnType<T['locator']> {
  return page.locator(`[data-workflow-id="${id}"]`) as ReturnType<T['locator']>;
}

async function cleanupWorkflows(
  request: Parameters<typeof seedWorkflow>[0],
  ids: string[],
) {
  for (const id of ids) {
    const response = await request.delete(`/api/workflows/${id}`);
    expect([200, 404]).toContain(response.status());
  }
}

test.describe('automations: Workflows browse list', () => {
  test('renders seeded workflows with a pluralized count and uniform one-line description space', async ({
    page,
    request,
  }) => {
    const ids: string[] = [];
    const emptyName = uniq('workflow-list-empty');
    const longName = `${uniq('workflow-list-long')} with a deliberately long name that must stay on one line`;
    const longDescription =
      'This description is intentionally long enough to require more than one line in the browse list so the row can prove that it clamps instead of growing.';

    try {
      const emptyId = await seedWorkflow(request, {
        name: emptyName,
        description: '',
      });
      ids.push(emptyId);
      const longId = await seedWorkflow(request, {
        name: longName,
        description: longDescription,
      });
      ids.push(longId);

      await page.goto('/automations');

      const rows = page.locator('[data-list-row][data-workflow-id]');
      for (const id of ids) await expect(workflowRow(page, id)).toBeVisible();

      const count = await rows.count();
      await expect(
        page.getByText(new RegExp(`^${count} workflow(s)?$`)),
      ).toHaveText(`${count} workflow${count === 1 ? '' : 's'}`);

      const emptyRow = workflowRow(page, emptyId);
      const longRow = workflowRow(page, longId);
      const emptyBody = emptyRow.locator('p');
      const longBody = longRow.locator('p');
      await expect(emptyBody).toHaveText('');
      await expect(emptyBody).toHaveCSS('height', '20px');
      await expect(longBody).toHaveCSS('height', '20px');

      const longBodyStyle = await longBody.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          lineClamp: style.webkitLineClamp,
          overflow: style.overflow,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        };
      });
      expect(longBodyStyle.lineClamp).toBe('1');
      expect(longBodyStyle.overflow).toBe('hidden');
      expect(longBodyStyle.scrollHeight).toBeGreaterThan(
        longBodyStyle.clientHeight,
      );

      const seededRows = page.locator(
        `[data-workflow-id="${emptyId}"], [data-workflow-id="${longId}"]`,
      );
      const heights = await seededRows.evaluateAll((elements) =>
        elements.map((element) => {
          const border = parseFloat(
            getComputedStyle(element).borderBottomWidth,
          );
          return element.getBoundingClientRect().height - border;
        }),
      );
      // ListRow drops only the final separator border; compare the row content
      // box so the description area, not that separator, owns the height.
      expect(new Set(heights).size).toBe(1);

      const titleStyle = await longRow
        .locator('[data-list-row-title]')
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            overflow: style.overflow,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
          };
        });
      expect(titleStyle).toEqual({
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      });

      for (const id of ids) {
        const row = workflowRow(page, id);
        await expect(row).not.toContainText(
          /Running|Web Search|test-direct|Last run|ago/i,
        );
        await expect(row.locator('.animate-spin')).toHaveCount(0);
      }
    } finally {
      await cleanupWorkflows(request, ids);
    }
  });

  test('navigates from a workflow name to its editor and uses list wording', async ({
    page,
    request,
  }) => {
    const name = uniq('workflow-list-edit');
    const id = await seedWorkflow(request, { name });

    try {
      await page.goto('/automations');
      const row = workflowRow(page, id);
      await expect(row).toBeVisible();
      await row.getByRole('link', { name, exact: true }).click();

      await expect(page).toHaveURL(`/automations/workflows/${id}`);
      await expect(
        page.getByRole('heading', { name: 'Edit Workflow', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByPlaceholder('Shown in the workflow list'),
      ).toBeVisible();
    } finally {
      await cleanupWorkflows(request, [id]);
    }
  });

  test('Run opens the launch modal without starting until the modal is submitted', async ({
    page,
    request,
  }) => {
    const id = await seedWorkflow(request, {
      name: uniq('workflow-list-run'),
      prompt: 'Say hello',
    });
    let runRequests = 0;
    const runPath = `/api/workflows/${id}/run`;
    page.on('request', (requestEvent) => {
      if (
        requestEvent.method() === 'POST' &&
        new URL(requestEvent.url()).pathname === runPath
      ) {
        runRequests += 1;
      }
    });

    try {
      await page.goto('/automations');
      const row = workflowRow(page, id);
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Run', exact: true }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(/Run “.*”/);
      await expect(
        dialog.getByText('This workflow takes no inputs — run it as-is.'),
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'Run', exact: true }),
      ).toBeVisible();
      expect(runRequests).toBe(0);

      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await cleanupWorkflows(request, [id]);
    }
  });

  test('keeps Schedule, Edit, and Delete controls visible and accessible', async ({
    page,
    request,
  }) => {
    const name = uniq('workflow-list-actions');
    const id = await seedWorkflow(request, { name });

    try {
      await page.goto('/automations');
      const row = workflowRow(page, id);
      await expect(row).toBeVisible();

      await expect(
        row.getByRole('link', { name: 'Schedule', exact: true }),
      ).toHaveAttribute('href', `/automations/schedules/new?workflow=${id}`);
      await expect(
        row.getByRole('link', { name: 'Edit', exact: true }),
      ).toHaveAttribute('href', `/automations/workflows/${id}`);
      await expect(
        row.getByRole('button', { name: 'Delete', exact: true }),
      ).toBeVisible();

      await row.getByRole('button', { name: 'Delete', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`Delete “${name}”`);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await cleanupWorkflows(request, [id]);
    }
  });

  test('keeps all row actions visible at desktop and mobile widths', async ({
    page,
    request,
  }) => {
    const id = await seedWorkflow(request, {
      name: uniq('workflow-list-responsive'),
    });

    try {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 375, height: 800 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto('/automations');
        const row = workflowRow(page, id);
        await expect(row).toBeVisible();

        const controls = [
          row.getByRole('button', { name: 'Run', exact: true }),
          row.getByRole('link', { name: 'Schedule', exact: true }),
          row.getByRole('link', { name: 'Edit', exact: true }),
          row.getByRole('button', { name: 'Delete', exact: true }),
        ];
        for (const control of controls) {
          await expect(control).toBeVisible();
          const box = await control.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        }
      }
    } finally {
      await cleanupWorkflows(request, [id]);
    }
  });
});
