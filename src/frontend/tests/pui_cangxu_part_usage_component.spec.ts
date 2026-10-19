import { expect, test } from '@playwright/test';

test('part usage validation selects sheets and lists every invalid row', async ({
  page
}) => {
  await page.goto(
    'http://localhost:5173/tests/fixtures/cangxu-part-usage-check-smoke.html'
  );

  const templateLink = page.getByRole('link', {
    name: '下载标准格式表格'
  });
  await expect(templateLink).toHaveAttribute(
    'href',
    '/api/cangxu/parts/usage-check/'
  );
  await expect(templateLink).toHaveAttribute(
    'download',
    '物料检验标准格式.xlsx'
  );

  await page.locator('input[type=file]').setInputFiles({
    name: 'synthetic-part-usage.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('synthetic xlsx content')
  });
  await page.getByRole('button', { name: '开始检验' }).click();

  await page.getByRole('combobox', { name: '工作表' }).click();
  await page.getByRole('option', { name: '合成第一页' }).click();
  await page.getByRole('button', { name: '检验所选工作表' }).click();

  const invalidSummary = page.getByLabel('不合格行摘要');
  await expect(invalidSummary).toContainText('工作表“合成第一页”');
  await expect(invalidSummary).toContainText('检查 2 行');
  await expect(invalidSummary).toContainText('2 行不合格');
  expect(await page.getByRole('columnheader').allTextContents()).toEqual([
    '行号',
    '不合格原因',
    '单机用量',
    '位号',
    '位号数量'
  ]);
  await expect(
    page.getByText('数量不一致：单机用量 2，位号 3 个')
  ).toBeVisible();
  await expect(page.getByText('位号第 2 段为空')).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: '原行内容' })
  ).toHaveCount(0);

  await page.getByRole('combobox', { name: '工作表' }).click();
  await page.getByRole('option', { name: '合成第二页' }).click();
  await page.getByRole('button', { name: '重新检验' }).click();
  await expect(page.getByText('表格有效')).toBeVisible();
  await expect(
    page.getByText('工作表“合成第二页”共检查 2 行，全部符合规则。')
  ).toBeVisible();

  const calls = await page.evaluate(
    () => (window as any).__partUsageCheckCalls
  );
  expect(calls).toEqual([
    { sheetName: null, filename: 'synthetic-part-usage.xlsx' },
    { sheetName: '合成第一页', filename: 'synthetic-part-usage.xlsx' },
    { sheetName: '合成第二页', filename: 'synthetic-part-usage.xlsx' }
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBeTruthy();
});

test('part usage validation reports a wrong B-column header', async ({
  page
}) => {
  await page.goto(
    'http://localhost:5173/tests/fixtures/cangxu-part-usage-check-smoke.html'
  );

  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid-header.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('synthetic xlsx content')
  });
  await page.getByRole('button', { name: '开始检验' }).click();

  await expect(
    page.getByText('B 列表头必须为“单机用量”，当前为“用量”')
  ).toBeVisible();
});

test('long designator lists are collapsed and can expand per row', async ({
  page
}) => {
  await page.goto(
    'http://localhost:5173/tests/fixtures/cangxu-part-usage-check-smoke.html'
  );

  await page.locator('input[type=file]').setInputFiles({
    name: 'long-designators.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('synthetic xlsx content')
  });
  await page.getByRole('button', { name: '开始检验' }).click();

  const designators = page.getByTestId('part-usage-designators-2');
  const expandButton = page.getByRole('button', {
    name: '展开全部（25 个）'
  });

  await expect(expandButton).toHaveAttribute('aria-expanded', 'false');
  expect(
    await designators.evaluate(
      (element) => getComputedStyle(element).webkitLineClamp
    )
  ).toBe('3');

  await expandButton.click();
  await expect(page.getByRole('button', { name: '收起' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  expect(
    await designators.evaluate(
      (element) => getComputedStyle(element).webkitLineClamp
    )
  ).toBe('none');

  await page.getByRole('button', { name: '收起' }).click();
  await expect(expandButton).toHaveAttribute('aria-expanded', 'false');
  expect(
    await designators.evaluate(
      (element) => getComputedStyle(element).webkitLineClamp
    )
  ).toBe('3');
});
