import type { Page, Locator, Route } from '@playwright/test';
import { expect, test } from './fixtures';
import { readFile } from 'node:fs/promises';
import { createBoard, importBooks, moveBook, type Board } from '../src/board/board';

async function openBoard(page: Page, board: Board) {
  await page.addInitScript((snapshot) => {
    localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot));
  }, board);
  await page.goto('/');
}

async function keyboardDrag(page: Page, card: Locator, key: string, targetId: string) {
  await card.scrollIntoViewIfNeeded();
  await card.focus();
  await page.keyboard.press('Space', { delay: 50 });
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(key, { delay: 50 });
  await expect(page.getByRole('status').filter({ hasText: `was moved over droppable area ${targetId}.` })).toHaveCount(1);
  await page.keyboard.press('Space', { delay: 50 });
}

async function addBooks(page: Page, text: string) {
  for (const book of text.split('\n')) {
    await page.getByLabel('Book title and author in natural language').fill(book);
    await page.getByRole('button', { name: '+ Add book' }).click();
    await expect(page.locator('.chrome-spinner')).toHaveCount(0);
  }
}

async function drag(page: Page, source: Locator, target: Locator) {
  await source.locator('xpath=ancestor::article').hover();
  await source.scrollIntoViewIfNeeded();
  const start = await source.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error('Drag elements are not visible.');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 10, start.y + start.height / 2, { steps: 3 });
  await page.mouse.move(end.x + end.width / 2, end.y + Math.min(end.height / 2, 80), { steps: 16 });
  await page.mouse.up();
}

test('static production build serves the SPA and has no backend routes', async ({ request }) => {
  const root = await request.get('/');
  expect(root.status()).toBe(200);
  expect(await root.text()).toContain('<div id="root">');
  const removed = await request.get('/api/health');
  expect(removed.headers()['content-type']).not.toContain('application/json');
  const spa = await request.get('/my-list');
  expect(spa.status()).toBe(200);
  expect(await spa.text()).toContain('<div id="root">');
  const script = (await root.text()).match(/src="([^"]+\.js)"/u)?.[1];
  expect(script).toBeDefined();
  const asset = await request.get(script!);
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-type']).toContain('javascript');
});

test('compact entry modes support keyboard submission and responsive structured fields', async ({ page }, testInfo) => {
  await page.goto('/');
  async function expectFullWidthEntry() {
    const panel = page.getByRole('region', { name: 'Add books', exact: true });
    const heading = await panel.getByRole('heading', { name: 'Add books', exact: true }).boundingBox();
    const form = await panel.locator('#entry-form').boundingBox();
    const content = await panel.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const left = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const right = parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight);
      return { x: bounds.x + left, width: bounds.width - left - right };
    });
    if (!heading || !form) throw new Error('Book entry heading and form are not visible.');
    expect(form.y).toBeGreaterThan(heading.y + heading.height);
    expect(Math.abs(form.x - content.x)).toBeLessThan(1);
    expect(Math.abs(form.width - content.width)).toBeLessThan(1);
    expect(Math.abs(heading.x - form.x)).toBeLessThan(1);
    expect(Math.abs(heading.width - form.width)).toBeLessThan(1);
    const panelBounds = await panel.boundingBox();
    const gallery = page.getByRole('region', { name: 'Your books', exact: true });
    const galleryBounds = await gallery.boundingBox();
    if (!panelBounds || !galleryBounds) throw new Error('Combined entry and gallery panel is not visible.');
    expect(galleryBounds.y).toBe(panelBounds.y + panelBounds.height);
    expect(galleryBounds.x).toBe(panelBounds.x);
    expect(galleryBounds.width).toBe(panelBounds.width);
    expect(await gallery.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(await panel.evaluate((element) => getComputedStyle(element).backgroundColor));
  }
  await expect(page.getByRole('button', { name: 'AI assisted', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const input = page.getByLabel('Book title and author in natural language');
  await expect(input).toHaveJSProperty('tagName', 'INPUT');
  const bounds = await input.boundingBox();
  if (!bounds) throw new Error('Book input is not visible.');
  expect(bounds.height).toBeLessThan(52);
  for (const width of [1360, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expectFullWidthEntry();
    const field = await input.boundingBox();
    const button = await page.getByRole('button', { name: '+ Add book', exact: true }).boundingBox();
    if (!field || !button) throw new Error('Chrome AI entry controls are not visible.');
    expect(button.x).toBeGreaterThan(field.x + field.width);
    expect(Math.abs(button.y + button.height / 2 - field.y - field.height / 2)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect(page.getByRole('link', { name: 'About the Prompt API' })).toHaveAttribute('href', 'https://developer.chrome.com/docs/ai/prompt-api');
  await input.fill('AI draft');
  await page.getByRole('button', { name: 'Manual entry', exact: true }).click();
  await page.getByLabel('Book name', { exact: true }).fill('Piranesi');
  await page.getByLabel('Author (optional)', { exact: true }).fill('Susanna Clarke');

  for (const width of [1360, 701, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expectFullWidthEntry();
    const title = await page.getByLabel('Book name', { exact: true }).boundingBox();
    const author = await page.getByLabel('Author (optional)', { exact: true }).boundingBox();
    if (!title || !author) throw new Error('Structured inputs are not visible.');
    const button = await page.getByRole('button', { name: '+ Add book', exact: true }).boundingBox();
    if (!button) throw new Error('Structured submit button is not visible.');
    if (width > 700) {
      expect(title.y).toBe(author.y);
      expect(title.x + title.width).toBeLessThan(author.x);
      expect(button.x).toBeGreaterThan(author.x + author.width);
      expect(Math.abs(button.y + button.height / 2 - author.y - author.height / 2)).toBeLessThan(1);
    } else {
      expect(author.y).toBeGreaterThan(title.y + title.height);
      expect(button.y).toBeGreaterThan(author.y + author.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`structured-${width}.png`), fullPage: true });
  }
  await page.getByLabel('Author (optional)', { exact: true }).press('Enter');
  await expect(page.getByRole('article', { name: 'Piranesi by Susanna Clarke' })).toBeVisible();
  await expect(page.getByLabel('Book name', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'AI assisted', exact: true }).click();
  await expect(input).toHaveValue('AI draft');
});

test('drag-to-rank hint floats outside the gallery only when there is room', async ({ page }) => {
  await page.goto('/');
  const gallery = page.getByRole('region', { name: 'Your books', exact: true });
  const hint = gallery.getByText('drag to rank', { exact: true });
  const zone = gallery.locator('.gallery-zone');
  for (const width of [1600, 1420, 1419, 1360, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width >= 1420) {
      await expect(hint).toBeVisible();
      await expect(gallery.locator('.ranking-hint svg')).toBeVisible();
      const hintBounds = await hint.boundingBox();
      const galleryBounds = await gallery.boundingBox();
      if (!hintBounds || !galleryBounds) throw new Error('Ranking hint and gallery are not visible.');
      expect(hintBounds.x).toBeGreaterThanOrEqual(0);
      expect(hintBounds.x + hintBounds.width).toBeLessThan(galleryBounds.x);
    } else {
      await expect(hint).toBeHidden();
    }
    const availableWidth = await gallery.evaluate((element) => {
      const style = getComputedStyle(element);
      return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    const zoneBounds = await zone.boundingBox();
    if (!zoneBounds) throw new Error('Book gallery is not visible.');
    expect(zoneBounds.width).toBeCloseTo(availableWidth, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await addBooks(page, 'Dune by Frank Herbert');
  await expect(gallery.getByRole('article', { name: 'Dune by Frank Herbert' })).toBeVisible();
  await expect(hint).toBeHidden();
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(hint).toBeVisible();
});

test('non-Chrome browsers default to structured entry and can add without a language model', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 Firefox/140.0' });
    Object.defineProperty(window, 'LanguageModel', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Manual entry', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'AI assisted', exact: true })).toHaveCount(0);
  await page.getByLabel('Book name', { exact: true }).fill('A book without AI');
  await page.getByRole('button', { name: '+ Add book', exact: true }).click();
  await expect(page.getByRole('article', { name: 'A book without AI by Unknown author' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('article', { name: 'A book without AI by Unknown author' })).toBeVisible();
});

test('Safari manual entry automatically matches covers without Chrome AI', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 Version/18.0 Safari/605.1.15' });
    Object.defineProperty(window, 'LanguageModel', { configurable: true, value: undefined });
  });
  await page.route('https://openlibrary.org/search.json?**', (route) => route.fulfill({ json: {
    docs: [{ key: '/works/OL123W', title: 'Hyperion', author_name: ['Dan Simmons'], cover_i: 123 }],
  } }));
  await page.route('https://openlibrary.org/works/OL123W/editions.json?**', (route) => route.fulfill({ json: {
    size: 2,
    entries: [
      { key: '/books/OL456M', title: 'Hyperion', publish_date: '2025-10-01', covers: [456] },
      { key: '/books/OL789M', title: 'Hyperion', publish_date: '1989', covers: [789] },
    ],
  } }));
  await page.goto('/');
  await page.getByLabel('Book name', { exact: true }).fill('Hyperion');
  await page.getByLabel('Author (optional)', { exact: true }).fill('Dan');
  await page.getByRole('button', { name: '+ Add book', exact: true }).click();
  const card = page.getByRole('article', { name: 'Hyperion by Dan Simmons' });
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toHaveAttribute('data-selected-cover', 'true');
  await expect(card.locator('img')).toHaveAttribute('data-cover-url', 'https://covers.openlibrary.org/b/id/456-M.jpg?default=false');
  await expect(page.getByText(/Chrome built-in AI is not available/)).toHaveCount(0);
  await page.reload();
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toHaveAttribute('data-selected-cover', 'true');
  await expect(card.locator('img')).toHaveAttribute('data-cover-url', 'https://covers.openlibrary.org/b/id/456-M.jpg?default=false');
});

test('Chrome AI submissions appear immediately, stay rankable, and process independently of further input', async ({ page }, testInfo) => {
  const prompts: Route[] = [];
  await page.route('**/test-ai-extraction?**', (route) => { prompts.push(route); });
  await page.goto('/');
  await page.evaluate(() => {
    window.LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async (text: string) => {
          const response = await fetch(`/test-ai-extraction?input=${encodeURIComponent(text)}`);
          return response.text();
        },
        destroy() {},
      }),
    };
  });
  const texts = ['  Dune: A Novel by Frank  Herbert  ', 'Invalid model result', 'Piranesi by Susanna Clarke'];
  const input = page.getByLabel('Book title and author in natural language');
  for (const text of texts) {
    await input.fill(text);
    await page.getByRole('button', { name: '+ Add book', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(input).toBeEnabled();
    const card = page.getByRole('article', { name: text.trim().replace(/\s+/gu, ' '), exact: true });
    expect(await card.locator('.book-title').textContent()).toBe(text);
    await expect(card.locator('.book-author')).toHaveCount(0);
    await expect(card.locator('.chrome-spinner')).toHaveCSS('animation-name', 'cover-spin');
  }
  await expect(page.locator('.gallery-zone article')).toHaveCount(3);
  await expect.poll(() => prompts.length).toBe(1);
  await expect(page.locator('#entry-form [role="status"]')).toHaveCount(0);
  await expect(page.getByText(/Preparing Chrome AI|Checking Chrome AI|Extracting and normalizing|Downloading Chrome AI/)).toHaveCount(0);
  await input.fill('Unsubmitted draft');
  const first = page.getByRole('article', { name: 'Dune: A Novel by Frank Herbert', exact: true });
  const id = await first.getAttribute('data-book-id');
  await keyboardDrag(page, first.getByRole('button', { name: 'Drag Dune: A Novel by Frank Herbert' }), 'ArrowDown', 'tier-S');
  await page.screenshot({ path: testInfo.outputPath('pending-chrome-ai.png'), fullPage: true });
  await prompts[0].fulfill({ json: { books: [{ title: 'Dune', author: 'Frank Herbert' }] } });
  const ranked = page.getByRole('region', { name: 'Tier S', exact: true }).getByRole('article', { name: 'Dune by Frank Herbert' });
  await expect(ranked).toHaveAttribute('data-book-id', id!);
  await expect.poll(() => prompts.length).toBe(2);
  await prompts[1].fulfill({ body: 'invalid JSON' });
  const failed = page.getByRole('article', { name: 'Invalid model result', exact: true });
  await expect(failed.getByRole('alert')).toContainText('invalid JSON');
  await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect.poll(() => prompts.length).toBe(3);
  await prompts[2].fulfill({ json: { books: [{ title: 'Piranesi', author: 'Susanna Clarke' }] } });
  await expect(page.getByRole('article', { name: 'Piranesi by Susanna Clarke' })).toBeVisible();
  await expect(input).toHaveValue('Unsubmitted draft');
  await expect(page.locator('.chrome-spinner')).toHaveCount(0);
});

test('pointer dragging, within-tier ordering, cross-tier moves, gallery return, and refresh', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1360, height: 1800 });
  await page.goto('/');
  await expect(page.locator('main > :first-child')).toHaveClass('entry-panel');
  await expect(page.getByRole('banner')).toHaveCount(0);
  await addBooks(page, 'Dune | Frank Herbert\nPiranesi | Susanna Clarke\nThe Hobbit | J. R. R. Tolkien');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.locator('.drag-handle')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Move .+ (earlier|later)$/ })).toHaveCount(0);
  await expect(page.locator('.card-actions').getByText(/\d+\s*\/\s*\d+/)).toHaveCount(0);
  const s = page.getByRole('region', { name: 'Tier S', exact: true });
  const a = page.getByRole('region', { name: 'Tier A', exact: true });
  const gallery = page.getByRole('region', { name: 'Your books', exact: true });
  await drag(page, gallery.getByText('Dune', { exact: true }), s.locator('.book-zone'));
  await expect(gallery.getByText('Dune', { exact: true })).toBeVisible();
  await expect(s.getByRole('article')).toHaveCount(0);
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await drag(page, gallery.getByRole('button', { name: 'Drag Dune', exact: true }), s.locator('.book-zone'));
  await expect(s.getByText('Dune', { exact: true })).toBeVisible();
  await drag(page, gallery.getByRole('button', { name: 'Drag Piranesi', exact: true }), s.locator('.book-zone'));
  await drag(page, s.getByRole('button', { name: 'Drag Piranesi', exact: true }), s.getByRole('article').filter({ hasText: 'Dune' }));
  await expect(s.getByRole('article').first()).toHaveAccessibleName('Piranesi by Susanna Clarke');
  await drag(page, s.getByRole('button', { name: 'Drag Dune', exact: true }), a.locator('.book-zone'));
  await expect(a.getByText('Dune', { exact: true })).toBeVisible();
  await drag(page, a.getByRole('button', { name: 'Drag Dune', exact: true }), gallery.locator('.book-zone'));
  await expect(gallery.getByText('Dune', { exact: true })).toBeVisible();
  await page.reload();
  await expect(s.getByText('Piranesi', { exact: true })).toBeVisible();
  await expect(gallery.getByText('Dune', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
});

test('drop zones stay highlighted over book cards and empty space throughout a drag', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 1800 });
  let board = importBooks(createBoard(), 'Moving book\nRanked book\nGallery book');
  board = moveBook(board, board.gallery[1], 'tier-S');
  await openBoard(page, board);
  const source = page.getByRole('button', { name: 'Drag Moving book', exact: true });
  await source.locator('xpath=ancestor::article').hover();
  const start = await source.boundingBox();
  if (!start) throw new Error('Drag source is not visible.');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 10, start.y + start.height / 2, { steps: 3 });
  await expect(page.locator('.drag-preview')).toBeVisible();

  const tier = page.getByRole('region', { name: 'Tier S', exact: true }).locator('.book-zone');
  const zone = await tier.boundingBox();
  if (!zone) throw new Error('Target tier is not visible.');
  await page.mouse.move(zone.x + zone.width - 20, zone.y + 40, { steps: 16 });
  await expect(tier).toHaveClass(/drop-over/u);
  const card = await tier.getByRole('article').boundingBox();
  if (!card) throw new Error('Target card is not visible.');
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 16 });
  await expect(tier).toHaveClass(/drop-over/u);
  await expect(page.locator('.drop-over')).toHaveCount(1);

  const emptyTier = page.getByRole('region', { name: 'Tier A', exact: true }).locator('.book-zone');
  const emptyBounds = await emptyTier.boundingBox();
  if (!emptyBounds) throw new Error('Empty tier is not visible.');
  await page.mouse.move(emptyBounds.x + emptyBounds.width / 2, emptyBounds.y + 40, { steps: 16 });
  await expect(emptyTier).toHaveClass(/drop-over/u);
  await expect(tier).not.toHaveClass(/drop-over/u);
  await expect(page.locator('.drop-over')).toHaveCount(1);

  const gallery = page.locator('.gallery-zone');
  const galleryCard = await gallery.getByRole('article', { name: 'Gallery book by Unknown author', exact: true }).boundingBox();
  if (!galleryCard) throw new Error('Gallery card is not visible.');
  await page.mouse.move(galleryCard.x + galleryCard.width / 2, galleryCard.y + galleryCard.height / 2, { steps: 16 });
  await expect(gallery).toHaveClass(/drop-over/u);
  await expect(emptyTier).not.toHaveClass(/drop-over/u);
  await expect(page.locator('.drop-over')).toHaveCount(1);

  await page.mouse.move(5, 5, { steps: 16 });
  await expect(page.locator('.drop-over')).toHaveCount(0);
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 16 });
  await expect(tier).toHaveClass(/drop-over/u);
  await page.mouse.up();
  await expect(tier.getByRole('article').first()).toHaveAccessibleName('Moving book by Unknown author');
  await expect(page.locator('.drop-over')).toHaveCount(0);

  await source.focus();
  await page.keyboard.press('Space', { delay: 50 });
  await page.keyboard.press('ArrowRight', { delay: 50 });
  await expect(tier).toHaveClass(/drop-over/u);
  await page.keyboard.press('Escape');
  await expect(page.locator('.drop-over')).toHaveCount(0);
});

test('hover and keyboard focus reveal a drag zone above edit and delete buttons', async ({ page }) => {
  let board = importBooks(createBoard(), 'Gallery book\nRanked book');
  board = moveBook(board, board.gallery[1], 'tier-S');
  await openBoard(page, board);

  for (const title of ['Gallery book', 'Ranked book']) {
    const card = page.getByRole('article', { name: `${title} by Unknown author`, exact: true });
    const actions = card.locator('.card-actions');
    const handle = card.getByRole('button', { name: `Drag ${title}`, exact: true });
    const edit = card.getByRole('button', { name: `Edit ${title}`, exact: true });
    const remove = card.getByRole('button', { name: `Remove ${title}`, exact: true });
    await page.mouse.move(0, 0);
    await expect(actions).toHaveCSS('opacity', '0');
    await expect(actions).toHaveCSS('pointer-events', 'none');
    await card.hover();
    await expect(actions).toHaveCSS('opacity', '1');
    await expect(card.locator('.book-content')).toHaveCSS('opacity', '0.8');
    await expect(remove).toHaveText('×');
    const handleBox = await handle.boundingBox();
    const editBox = await edit.boundingBox();
    const buttonBox = await remove.boundingBox();
    if (!handleBox || !editBox || !buttonBox) throw new Error('Book controls have no bounds.');
    expect(handleBox.width).toBeGreaterThan(editBox.width);
    expect(handleBox.y + handleBox.height).toBeLessThan(editBox.y);
    expect(editBox.y).toBe(buttonBox.y);
    expect(editBox.x + editBox.width).toBeLessThan(buttonBox.x);
    await page.mouse.move(0, 0);
    await expect(actions).toHaveCSS('opacity', '0');
    await card.getByRole('button', { name: `Drag ${title}`, exact: true }).focus();
    await expect(actions).toHaveCSS('opacity', '1');
    await page.keyboard.press('Tab');
    await expect(edit).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);
    await expect(page.locator('.drag-preview')).toHaveCount(0);
  }
  await expect.poll(() => page.evaluate(() => {
    const saved = localStorage.getItem('shelf-life.board.v1');
    return saved ? JSON.parse(saved).books.length : null;
  })).toBe(0);
});

test('keyboard dragging and tier settings preserve book placement', async ({ page }) => {
  await page.goto('/');
  await addBooks(page, 'One\nTwo');
  const s = page.getByRole('region', { name: 'Tier S', exact: true });
  const gallery = page.getByRole('region', { name: 'Your books', exact: true });
  await keyboardDrag(page, gallery.getByRole('button', { name: 'Drag One', exact: true }), 'ArrowDown', 'tier-S');
  await expect(s.getByText('One', { exact: true })).toBeVisible();
  const targetId = await s.getByRole('article').first().getAttribute('data-book-id');
  if (!targetId) throw new Error('The ranked book has no identifier.');
  await keyboardDrag(page, gallery.getByRole('button', { name: 'Drag Two', exact: true }), 'ArrowDown', targetId);
  await expect(s.getByRole('article').first()).toHaveAccessibleName('Two by Unknown author');
  await keyboardDrag(page, s.getByRole('button', { name: 'Drag Two', exact: true }), 'ArrowRight', targetId);
  await expect(s.getByRole('article').last()).toHaveAccessibleName('Two by Unknown author');
  await expect(s.getByRole('button', { name: 'Drag Two', exact: true })).not.toHaveAttribute('aria-pressed', 'true');
  await keyboardDrag(page, s.getByRole('button', { name: 'Drag Two', exact: true }), 'ArrowLeft', targetId);
  await expect(s.getByRole('article').first()).toHaveAccessibleName('Two by Unknown author');
  await page.getByRole('button', { name: /Tier settings/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name for tier 1', { exact: true }).fill('Favorites');
  await dialog.getByLabel('Name for tier 1', { exact: true }).press('Tab');
  await dialog.getByLabel('Color for tier Favorites').fill('#c2ddee');
  await dialog.getByRole('button', { name: 'Move tier Favorites down', exact: true }).click();
  await expect(dialog.getByLabel('Name for tier 2', { exact: true })).toHaveValue('Favorites');
  await dialog.getByRole('button', { name: '+ Add a tier' }).click();
  await expect(dialog.getByRole('textbox', { name: /Name for tier/ })).toHaveCount(7);
  await dialog.getByRole('button', { name: 'Delete tier Favorites', exact: true }).click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(gallery.getByRole('article')).toHaveCount(2);
  await expect(gallery.getByRole('article').first()).toHaveAccessibleName('Two by Unknown author');
  await addBooks(page, ' ONE | Unknown author');
  await expect(page.getByRole('alert')).toContainText('already');
  await page.getByRole('article', { name: 'ONE | Unknown author', exact: true }).hover();
  await page.getByRole('button', { name: 'Remove ONE | Unknown author', exact: true }).click();
  await expect(gallery.getByRole('article')).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Tier S', exact: true })).toHaveCount(0);
  await expect(gallery.getByRole('article')).toHaveCount(2);
});

test('responsive gallery stays a single scrolling row and tier cards wrap', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let board = importBooks(createBoard(), Array.from({ length: 8 }, (_, index) => `Book ${index}`).join('\n'));
  for (const id of board.gallery.slice(0, 4)) board = moveBook(board, id, 'tier-S');
  await openBoard(page, board);
  const gallery = page.locator('.gallery-zone');
  const geometry = await gallery.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    width: element.clientWidth,
    tops: Array.from(element.querySelectorAll('article')).map((card) => card.getBoundingClientRect().top),
  }));
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.width);
  expect(new Set(geometry.tops).size).toBe(1);
  const positions = await page.getByRole('region', { name: 'Tier S', exact: true }).getByRole('article').evaluateAll(
    (cards) => cards.map((card) => card.getBoundingClientRect().top),
  );
  expect(new Set(positions).size).toBeGreaterThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

for (const width of [1360, 390, 320]) {
  test(`reading pile stays visible while scrolling and ranking lower tiers at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const board = importBooks(createBoard(), Array.from({ length: 12 }, (_, index) => `Book ${index}`).join('\n'));
    await openBoard(page, board);
    const gallery = page.getByRole('region', { name: 'Your books', exact: true });
    const zone = gallery.locator('.gallery-zone');
    const lowerTier = page.getByRole('region', { name: 'Tier E', exact: true });
    const initial = await gallery.boundingBox();
    if (!initial) throw new Error('Reading pile is not visible.');
    expect(initial.y).toBeGreaterThan(0);
    await expect(gallery).toHaveCSS('box-shadow', 'none');
    const entry = page.getByRole('region', { name: 'Add books', exact: true });
    const toggle = entry.getByRole('button', { name: 'Add books', exact: true });
    await toggle.click();
    await expect(entry.locator('#entry-form')).toBeHidden();
    await expect(gallery).toBeInViewport();
    const collapsedEntry = await entry.boundingBox();
    const collapsedGallery = await gallery.boundingBox();
    if (!collapsedEntry || !collapsedGallery) throw new Error('Collapsed entry and gallery are not visible.');
    expect(collapsedGallery.y).toBe(collapsedEntry.y + collapsedEntry.height);
    await toggle.click();

    await lowerTier.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await gallery.boundingBox())?.y).toBe(0);
    await expect(gallery).not.toHaveCSS('box-shadow', 'none');
    await expect(toggle).not.toBeInViewport();
    await expect(entry.locator('#entry-form')).not.toBeInViewport();
    const pinned = await gallery.boundingBox();
    const destination = await lowerTier.boundingBox();
    if (!pinned || !destination) throw new Error('Reading pile or lower tier is not visible.');
    expect(destination.y).toBeGreaterThanOrEqual(pinned.y + pinned.height);
    expect(destination.y + destination.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await zone.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect.poll(() => zone.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(gallery.getByRole('article', { name: 'Book 11 by Unknown author', exact: true })).toBeInViewport();
    await zone.evaluate((element) => { element.scrollLeft = 0; });
    await drag(page, gallery.getByRole('button', { name: 'Drag Book 0', exact: true }), lowerTier.locator('.tier-zone'));
    await expect(lowerTier.getByRole('article', { name: 'Book 0 by Unknown author', exact: true })).toBeVisible();
    await expect(gallery.getByRole('article')).toHaveCount(11);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await gallery.boundingBox())?.y).toBe(initial.y);
    await expect(gallery).toHaveCSS('box-shadow', 'none');
    await expect.poll(() => page.evaluate(() => {
      const saved = localStorage.getItem('shelf-life.board.v1');
      return saved ? JSON.parse(saved).tiers.find((tier: { id: string }) => tier.id === 'tier-E').bookIds : [];
    })).toEqual([board.gallery[0]]);
  });
}

test.describe('touch interaction', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('swiping card content scrolls the gallery and holding its handle allows dragging', async ({ page }) => {
    await openBoard(page, importBooks(createBoard(), Array.from({ length: 8 }, (_, index) => `Book ${index}`).join('\n')));
    const session = await page.context().newCDPSession(page);
    const gallery = page.locator('.gallery-zone');
    const bounds = await gallery.boundingBox();
    if (!bounds) throw new Error('Gallery is not visible.');
    const y = bounds.y + 145;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
    for (let x = 280; x >= 80; x -= 20) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => gallery.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(page.locator('.is-dragging')).toHaveCount(0);

    const card = gallery.getByRole('button', { name: 'Drag Book 0', exact: true });
    await card.scrollIntoViewIfNeeded();
    const source = await card.boundingBox();
    const destination = await page.locator('[data-zone="tier-S"]').boundingBox();
    if (!source || !destination) throw new Error('Touch drag elements are not visible.');
    const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const end = { x: destination.x + destination.width / 2, y: Math.min(destination.y + 60, 800) };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    for (let step = 1; step <= 12; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start.x + (end.x - start.x) * step / 12, y: start.y + (end.y - start.y) * step / 12 }],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('region', { name: 'Tier S', exact: true }).getByText('Book 0', { exact: true })).toBeVisible();
  });
});

test('downloads a full tier-only JPEG with long labels and offscreen rows', async ({ page }, testInfo) => {
  let board = importBooks(createBoard(), [
    ...Array.from({ length: 30 }, (_, index) => `Ranked ${index}: ${'A long book title '.repeat(4)} | An author with a long name`),
    'Unranked secret',
  ].join('\n'));
  const rankedIds = board.gallery.slice(0, 30);
  for (let index = 0; index < 30; index++) {
    board = moveBook(board, rankedIds[index], index === 29 ? 'tier-E' : 'tier-S');
  }
  await openBoard(page, board);
  const exported = page.locator('.export-board');
  await expect(exported.locator('.book-card')).toHaveCount(30);
  await expect(exported.locator('.tier-row')).toHaveCount(6);
  expect(await exported.textContent()).not.toContain('Unranked secret');
  expect(await exported.textContent()).not.toContain('My book tier list');
  expect(await exported.textContent()).not.toContain('Book ranks');
  await expect(exported.locator('header, footer')).toHaveCount(0);
  expect(await exported.locator('button, select, textarea, input').count()).toBe(0);
  const margins = await exported.evaluate((element) => {
    const outer = element.getBoundingClientRect();
    const board = element.querySelector('.tier-board')!.getBoundingClientRect();
    return {
      top: board.top - outer.top, right: outer.right - board.right,
      bottom: outer.bottom - board.bottom, left: board.left - outer.left,
    };
  });
  expect(margins).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
  const dimensions = await exported.evaluate((element) => ({ width: element.scrollWidth, height: element.scrollHeight }));
  expect(dimensions.height).toBeGreaterThan(900);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ Export JPEG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('my-book-tier-list.jpg');
  const file = testInfo.outputPath('tier-list.jpg');
  await download.saveAs(file);
  const bytes = await readFile(file);
  expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  const decoded = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkTop = 0;
    let darkBottom = 0;
    for (let y = 0; y < canvas.height; y += 3) {
      for (let x = 0; x < canvas.width; x += 3) {
        const offset = (y * canvas.width + x) * 4;
        if (data[offset] < 160 && data[offset + 1] < 160 && data[offset + 2] < 160) {
          if (y < canvas.height / 2) darkTop++;
          else darkBottom++;
        }
      }
    }
    return { width: image.naturalWidth, height: image.naturalHeight, darkTop, darkBottom };
  }, bytes.toString('base64'));
  expect(decoded.width).toBe(dimensions.width * 2);
  expect(decoded.height).toBe(dimensions.height * 2);
  expect(decoded.darkTop).toBeGreaterThan(1000);
  expect(decoded.darkBottom).toBeGreaterThan(1000);
  await expect(page.getByRole('button', { name: '↓ Export JPEG' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('app.png'), fullPage: true });
  await testInfo.attach('Exported full board', { path: file, contentType: 'image/jpeg' });
});
