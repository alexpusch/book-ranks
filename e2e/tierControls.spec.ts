import { expect, test } from './fixtures';
import { createBoard, importBooks, moveBook } from '../src/board/board';

test('tier names wrap between words without splitting words while editing, resizing, and exporting', async ({
  page,
}) => {
  const board = createBoard();
  const names = ['S', 'Favorites', 'WWWWWWWWWWWW', 'A very long tier name with many whole words'];
  board.tiers = board.tiers.slice(0, names.length).map((tier, index) => ({ ...tier, name: names[index] }));
  await page.addInitScript((snapshot) => {
    localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot));
  }, board);
  await page.goto('/');

  for (const width of [1360, 320, 1360]) {
    await page.setViewportSize({ width, height: 900 });
    const short = page.getByRole('region', { name: 'Tier S', exact: true }).locator('.tier-name');
    await expect(short).toHaveCSS('font-size', width === 320 ? '28px' : '35px');
    for (const [index, name] of names.entries()) {
      for (const exported of [false, true]) {
        const heading = exported
          ? page.locator('.export-board .tier-name').nth(index)
          : page.getByRole('region', { name: `Tier ${name}`, exact: true }).locator('.tier-name');
        await expect(async () => {
          const dimensions = await heading.evaluate((element) => {
            const text = element.querySelector('button') ?? element;
            const words = Array.from(text.textContent!.matchAll(/\S+/gu), (match) => {
              const range = document.createRange();
              range.setStart(text.firstChild!, match.index);
              range.setEnd(text.firstChild!, match.index + match[0].length);
              return { width: range.getBoundingClientRect().width, lines: range.getClientRects().length };
            });
            const style = getComputedStyle(text);
            return {
              words,
              available: text.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
              fontSize: parseFloat(style.fontSize),
              height: text.getBoundingClientRect().height,
            };
          });
          for (const word of dimensions.words) {
            expect(word.width).toBeLessThanOrEqual(dimensions.available);
            expect(word.lines).toBe(1);
          }
          const maximum = exported || width !== 320 ? 35 : 28;
          if (name === 'S') expect(dimensions.fontSize).toBe(maximum);
          else if (index === 3) {
            expect(dimensions.height).toBeGreaterThan(dimensions.fontSize * 2);
          } else {
            expect(dimensions.fontSize).toBeLessThan(maximum);
            expect(dimensions.height).toBeLessThanOrEqual(dimensions.fontSize * 1.2 + 7);
          }
        }).toPass({ timeout: 5000 });
      }
    }

    await page.getByRole('button', { name: 'Rename tier Favorites', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Name for tier Favorites' });
    let shortSize = 0;
    for (const value of ['S', 'Favorites', 'W'.repeat(60), 'Many short words on separate lines', 'S']) {
      await input.fill(value);
      await expect.poll(() => input.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect.poll(() => input.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
      const size = await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
      if (value === 'S') {
        expect(size).toBe(width === 320 ? 28 : 35);
        shortSize = size;
      } else expect(size).toBeLessThan(shortSize);
    }
    await input.press('Escape');
    await expect(page.getByRole('button', { name: 'Rename tier Favorites', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

for (const touch of [false, true]) {
  test.describe(touch ? 'Touch tier controls' : 'Keyboard tier controls', () => {
    test.use({ hasTouch: touch, viewport: { width: 320, height: 900 } });

    test('edits, inserts, and confirms deletion inside narrow tier titles', async ({ page }, testInfo) => {
      let board = importBooks(createBoard(), 'One\nTwo');
      board.tiers = board.tiers.slice(0, 2);
      board.books.forEach((book) => {
        book.coverSelection = { kind: 'placeholder' };
      });
      board = moveBook(board, board.gallery[0], 'tier-S');
      await page.addInitScript((snapshot) => {
        if (!localStorage.getItem('shelf-life.board.v1')) {
          localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot));
        }
      }, board);
      await page.goto('/');
      const tier = page.getByRole('region', { name: 'Tier S', exact: true });
      const title = tier.getByRole('button', { name: 'Rename tier S', exact: true });
      const remove = page.getByRole('button', { name: 'Delete tier Favorites', exact: true });
      await tier.scrollIntoViewIfNeeded();
      if (touch) {
        await expect(tier.locator('.tier-title-actions')).toHaveCSS('opacity', '1');
        await expect(tier.locator('.tier-book-count')).toHaveCSS('opacity', '0');
        await title.tap();
      } else {
        await expect(tier.locator('.tier-title-actions')).toHaveCSS('opacity', '0');
        await expect(tier.locator('.tier-book-count')).toHaveCSS('opacity', '0.75');
        const restingTitleBounds = await tier.locator('.tier-name').boundingBox();
        const detailBounds = await tier.locator('.tier-title-detail').boundingBox();
        if (!restingTitleBounds || !detailBounds) throw new Error('Tier title details are missing.');
        expect(detailBounds.y - restingTitleBounds.y - restingTitleBounds.height).toBeCloseTo(2, 0);
        await expect(title).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await tier.locator('.tier-label').hover({ position: { x: 2, y: 35 } });
        await expect(title).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.19)');
        await title.hover();
        await expect(title).toHaveCSS('filter', 'none');
        await expect(tier.locator('.tier-title-actions')).toHaveCSS('opacity', '1');
        await expect(tier.locator('.tier-book-count')).toHaveCSS('opacity', '0');
        expect(await tier.locator('.tier-title-detail').boundingBox()).toEqual(detailBounds);
        await page.mouse.move(0, 0);
        await expect(tier.locator('.tier-title-actions')).toHaveCSS('opacity', '0');
        await expect(tier.locator('.tier-book-count')).toHaveCSS('opacity', '0.75');
        await expect(title).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await title.focus();
        await expect(tier.locator('.tier-title-actions')).toHaveCSS('opacity', '1');
        await expect(tier.locator('.tier-book-count')).toHaveCSS('opacity', '0');
        await page.keyboard.press('Enter');
      }

      const name = page.getByRole('textbox', { name: 'Name for tier S' });
      await expect(name).toBeFocused();
      await expect(name).toHaveJSProperty('selectionStart', 1);
      await expect(name).toHaveJSProperty('selectionEnd', 1);
      await expect(name).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.19)');
      await expect(name).toHaveCSS('outline-style', 'none');
      await expect(name).toHaveCSS('border-width', '0px');
      await name.fill(' ');
      await name.press('Enter');
      await expect(tier.getByRole('alert')).toHaveText('Tier name cannot be empty. Previous name retained.');
      await title.click();
      await name.fill('Favorites');
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 320);
      await expect(tier.locator('.tier-label')).toHaveCSS('width', '65px');
      await page.screenshot({ path: testInfo.outputPath('direct-name-editing.png'), fullPage: true });
      await name.press('Tab');
      const favorites = page.getByRole('region', { name: 'Tier Favorites', exact: true });
      await page.getByLabel('Color for tier Favorites').fill('#aabbcc');
      await expect(favorites.locator('.tier-label')).toHaveCSS('background-color', 'rgb(170, 187, 204)');
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
      const colorBounds = await favorites.locator('.tier-color-picker').boundingBox();
      const nameBounds = await favorites.locator('.tier-name').boundingBox();
      const deleteBounds = await remove.boundingBox();
      const labelBounds = await favorites.locator('.tier-label').boundingBox();
      if (!colorBounds || !nameBounds || !deleteBounds || !labelBounds) throw new Error('Tier controls are missing.');
      expect(colorBounds.y).toBeGreaterThanOrEqual(nameBounds.y + nameBounds.height);
      expect(deleteBounds.x - colorBounds.x - colorBounds.width).toBeCloseTo(4, 0);
      expect(deleteBounds.y).toBe(colorBounds.y);
      expect(deleteBounds.width).toBe(colorBounds.width);
      expect(deleteBounds.height).toBe(colorBounds.height);
      expect(deleteBounds.x + deleteBounds.width).toBeLessThanOrEqual(labelBounds.x + labelBounds.width);
      await expect(remove).toHaveCSS('border-radius', '5px');

      const before = page.getByRole('button', { name: 'Insert tier before Favorites' });
      if (touch) {
        await expect(before).toHaveCSS('opacity', '1');
        await before.tap();
      } else {
        await before.focus();
        await before.press('Enter');
      }
      await expect(page.getByLabel('Name for tier New tier')).toBeFocused();
      await expect(page.getByLabel('Name for tier New tier')).toHaveJSProperty('selectionStart', 8);
      await expect(page.getByLabel('Name for tier New tier')).toHaveJSProperty('selectionEnd', 8);
      await page.getByLabel('Name for tier New tier').fill('First');
      await page.getByLabel('Name for tier New tier').press('Enter');
      await page.getByRole('button', { name: 'Insert tier after A' }).focus();
      await page.keyboard.press('Enter');
      await page.getByLabel('Name for tier New tier').fill('Last');
      await page.getByLabel('Name for tier New tier').press('Enter');
      await expect(page.locator('main .tier-row')).toHaveCount(4);
      await expect(page.locator('main .tier-row').first()).toHaveAccessibleName('Tier First');
      await expect(page.locator('main .tier-row').last()).toHaveAccessibleName('Tier Last');

      await remove.focus();
      if (touch) await remove.tap();
      else await remove.press('Enter');
      const confirm = favorites.getByRole('button', { name: 'Confirm deletion of tier Favorites', exact: true });
      await expect(confirm).toHaveText('?');
      await expect(confirm).toBeFocused();
      await expect(favorites.getByRole('button', { name: 'Rename tier Favorites' })).toBeVisible();
      await expect(favorites.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
      await page.getByRole('heading', { name: 'Rank the books', exact: true }).click();
      await remove.focus();
      await expect(remove.locator('svg')).toHaveCount(1);
      await remove.press('Enter');
      if (touch) await confirm.tap();
      else await confirm.press('Enter');
      await expect(favorites).toHaveCount(0);
      const gallery = page.getByRole('region', { name: 'Your books', exact: true });
      await expect(gallery.getByRole('article')).toHaveCount(2);
      await expect(gallery.getByRole('article').last()).toHaveAccessibleName('One by Unknown author');
      await page.reload();
      await expect(page.locator('main .tier-row')).toHaveCount(3);
      await expect(gallery.getByRole('article')).toHaveCount(2);
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 320);
    });
  });
}
