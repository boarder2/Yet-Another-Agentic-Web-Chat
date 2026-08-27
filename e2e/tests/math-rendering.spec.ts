import { test, expect } from '../fixtures';
import { seedFormulaChat } from '../utils/seed';

test.describe('chat formula rendering', () => {
  test('renders historical formulas with protected and invalid source intact', async ({
    page,
    request,
  }) => {
    const { chatId, content } = await seedFormulaChat(request);

    await page.goto(`/c/${chatId}`);
    const userMessage = page.locator('[id^="msg-"]').first();
    await expect(userMessage.locator('.yaawc-formula-inline')).toHaveCount(1);

    const answer = page.locator('[data-answer]').last();
    await expect(answer.locator('.yaawc-formula-inline')).toHaveCount(4);
    await expect(answer.locator('.yaawc-formula-display')).toHaveCount(3);

    // KaTeX emits an accessible MathML tree alongside its visual markup for
    // every formula in the normal answer, including the visible link label.
    await expect(answer.locator('math')).toHaveCount(7);
    await expect(
      answer.locator('annotation[encoding="application/x-tex"]'),
    ).toHaveCount(7);
    await expect(answer.locator('.katex-error')).toHaveCount(0);

    const destination = answer.locator(
      'a[href="https://example.test/$destination$"]',
    );
    await expect(destination).toHaveCount(1);
    await expect(destination.locator('.yaawc-formula-inline')).toHaveCount(1);

    const inlineCode = answer.locator('code').filter({
      hasText: '$not-a-formula$',
    });
    await expect(inlineCode).toHaveCount(1);
    await expect(inlineCode.locator('.yaawc-formula')).toHaveCount(0);
    const fencedCode = answer.locator('code').filter({
      hasText: '$fenced-formula$',
    });
    await expect(fencedCode).toHaveCount(1);
    await expect(fencedCode.locator('.yaawc-formula')).toHaveCount(0);

    await expect(answer).toContainText(
      'Currency remains literal: $20 and $30.',
    );
    await expect(
      answer.locator('strong').filter({ hasText: '$5.62/gallon' }),
    ).toHaveCount(1);
    const currencyTable = answer.locator('table').filter({
      hasText: 'Avg. regular gasoline ($/gal)',
    });
    await expect(currencyTable).toHaveCount(1);
    await expect(
      currencyTable.locator('strong').filter({ hasText: 'United States' }),
    ).toHaveCount(1);
    await expect(
      currencyTable.locator('strong').filter({ hasText: '$4.085' }),
    ).toHaveCount(1);
    await expect(answer).toContainText(String.raw`Invalid: $\frac{1$.`);
    await expect(answer).toContainText(
      String.raw`Unsupported: $\href{https://example.test}{unsafe}$.`,
    );

    // The fixture is historical content: rendering must not rewrite the
    // persisted LaTeX or its writer-owned widget envelopes.
    const body = await (await request.get(`/api/chats/${chatId}`)).json();
    const assistant = body.messages.find(
      (message: { role: string }) => message.role === 'assistant',
    ) as { content: string };
    expect(assistant.content).toBe(content);
  });

  test('renders formulas inside panel and subagent responses without widening the page', async ({
    page,
    request,
  }) => {
    const { chatId } = await seedFormulaChat(request);

    await page.goto(`/c/${chatId}`);
    const answer = page.locator('[data-answer]').last();

    const panel = answer
      .locator('[data-execution]')
      .filter({ hasText: 'Agent Panel · 1 models' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: /Agent Panel · 1 models/ }).click();

    // The desktop and mobile layouts are both mounted; assert the desktop
    // column so the same executor is not counted twice.
    const desktopColumns = panel.locator('div.hidden.sm\\:flex');
    await expect(desktopColumns.locator('.yaawc-formula-inline')).toHaveCount(
      1,
    );
    await expect(desktopColumns.locator('.yaawc-formula-display')).toHaveCount(
      1,
    );
    await expect(desktopColumns.locator('math')).toHaveCount(2);

    const subagent = answer
      .locator('[data-execution]')
      .filter({ hasText: 'Deep Research' });
    await expect(subagent).toBeVisible();
    await subagent.locator('button').first().click();
    await subagent
      .getByRole('button', { name: 'Response', exact: true })
      .click();
    await expect(subagent.locator('.yaawc-formula-inline')).toHaveCount(1);
    await expect(subagent.locator('.yaawc-formula-display')).toHaveCount(1);
    await expect(subagent.locator('math')).toHaveCount(2);

    const subagentCode = subagent.locator('code').filter({
      hasText: '$subagent-code$',
    });
    await expect(subagentCode).toHaveCount(1);
    await expect(subagentCode.locator('.yaawc-formula')).toHaveCount(0);
    await expect(answer.locator('.katex-error')).toHaveCount(0);

    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const displays = Array.from(
        document.querySelectorAll<HTMLElement>('.yaawc-formula-display'),
      );
      return {
        viewportWidth: root.clientWidth,
        documentWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
        displays: displays.map((element) => ({
          overflowX: getComputedStyle(element).overflowX,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.displays.length).toBeGreaterThan(0);
    expect(
      layout.displays.every((display) => display.overflowX === 'auto'),
    ).toBe(true);
  });
});
