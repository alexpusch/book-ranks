import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { createBoard, importBooks, moveBook } from '../src/board/board';

test('theme toggle styles the page and dialogs and produces matching JPEG pixels', async ({ page }, testInfo) => {
  let board = importBooks(createBoard(), [{ title: 'Dune', author: 'Frank Herbert' }]);
  board = moveBook(board, board.books[0].id, board.tiers[0].id);
  board.books[0].coverSelection = { kind: 'placeholder' };
  await page.addInitScript((snapshot) => {
    localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot));
  }, board);
  await page.goto('/');
  const toggle = page.getByRole('switch', { name: /^(Dark|Light) mode$/ });
  const settings = page.getByRole('button', { name: /Tier settings/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  for (const dark of [false, true]) {
    if (dark) await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(dark));
    await expect(toggle).toHaveAccessibleName(dark ? 'Light mode' : 'Dark mode');
    await expect(toggle).toHaveText('');
    await expect(toggle.locator('svg circle')).toHaveCount(dark ? 1 : 0);
    await expect(toggle.locator('.theme-switch-thumb'))
      .toHaveCSS('transform', dark ? 'matrix(1, 0, 0, 1, 13, 0)' : 'none');
    const pageColor = dark ? 'rgb(22, 22, 22)' : 'rgb(247, 245, 240)';
    const boardColor = dark ? 'rgb(34, 34, 34)' : 'rgb(252, 251, 247)';
    await expect(page.locator('html')).toHaveCSS('background-color', pageColor);
    await expect(page.locator('main .tier-board')).toHaveCSS('background-color', boardColor);
    await expect(page.locator('main .book-title')).toHaveCSS('color', dark ? 'rgb(230, 230, 230)' : 'rgb(52, 62, 49)');
    await expect(page.getByRole('button', { name: '+ Add book', exact: true }))
      .toHaveCSS('background-color', dark ? 'rgb(120, 96, 47)' : 'rgb(49, 77, 61)');
    await expect(settings).toHaveCSS('background-color', dark ? 'rgb(53, 46, 32)' : 'rgb(250, 249, 244)');
    await settings.click();
    await expect(page.getByRole('dialog')).toHaveCSS('background-color', pageColor);
    await page.keyboard.press('Escape');

    for (const width of [1360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await toggle.scrollIntoViewIfNeeded();
      await expect(toggle).toBeVisible();
      const bounds = await toggle.boundingBox();
      const settingsBounds = await settings.boundingBox();
      if (!bounds || !settingsBounds) throw new Error('Theme and settings controls are not visible.');
      expect(bounds.x).toBeGreaterThanOrEqual(settingsBounds.x + settingsBounds.width);
      expect(bounds.y).toBe(settingsBounds.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }

    await page.screenshot({ path: testInfo.outputPath(`${dark ? 'dark' : 'light'}.png`), fullPage: true });
    if (dark) {
      await page.evaluate(() => {
        Object.defineProperty(document.fonts, 'ready', {
          configurable: true,
          value: new Promise((resolve) => {
            window.addEventListener('resume-export', () => resolve(document.fonts), { once: true });
          }),
        });
      });
    }
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    if (dark) {
      await expect(page.getByRole('button', { name: 'Creating JPEG...' })).toBeDisabled();
      await toggle.click();
      await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(247, 245, 240)');
      await page.evaluate(() => window.dispatchEvent(new Event('resume-export')));
    }
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('my-book-tier-list.jpg');
    const file = testInfo.outputPath(`${dark ? 'dark' : 'light'}.jpg`);
    await download.saveAs(file);
    const samples = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/jpeg;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable.');
      context.drawImage(image, 0, 0);
      const scale = image.naturalWidth / 1100;
      return [[2, 2], [800, 50], [40, 50]].map(([x, y]) =>
        Array.from(context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data).slice(0, 3));
    }, (await readFile(file)).toString('base64'));
    const expected = [
      dark ? [22, 22, 22] : [247, 245, 240],
      dark ? [34, 34, 34] : [252, 251, 247],
      board.tiers[0].color.match(/[a-f\d]{2}/giu)!.map((channel) => parseInt(channel, 16)),
    ];
    samples.forEach((sample, index) => sample.forEach((channel, component) =>
      expect(Math.abs(channel - expected[index][component])).toBeLessThanOrEqual(5)));
  }

  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(247, 245, 240)');
});
