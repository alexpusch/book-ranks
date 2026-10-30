import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { readFile } from 'node:fs/promises';
import { createBoard, importBooks, moveBook } from '../src/board/board';

test('title-only Chrome AI entry matches Children of Ruin despite a legacy edition search result', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    Object.defineProperty(window, 'LanguageModel', {
      configurable: true,
      value: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async (input: string) => input === 'Children of Ruin'
            ? JSON.stringify({ books: [{ title: 'Children of Ruin', author: '' }] })
            : JSON.stringify({ workId: 'OL20079532W' }),
          destroy() {},
        }),
      },
    });
  });
  const searches: { title: string | null; author: string | null }[] = [];
  await page.route('https://openlibrary.org/search.json?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    searches.push({ title: params.get('title'), author: params.get('author') });
    await route.fulfill({ json: { docs: [
      { key: '/works/OL20079532W', title: 'Children of Ruin', author_name: ['Adrian Tchaikovsky'], cover_i: 8750923 },
      { key: '/works/OL16367778M', title: 'The unanswered prayer, or, Why do so many children of the church go to ruin?' },
    ] } });
  });
  await page.getByLabel('Book title and author in natural language').fill('Children of Ruin');
  await page.getByRole('button', { name: '+ Add book' }).click();
  const card = page.getByRole('article', { name: 'Children of Ruin by Adrian Tchaikovsky', exact: true });
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toHaveAttribute('src', /\/8750923-M\.jpg/);
  expect(searches).toEqual([{ title: 'Children of Ruin', author: null }]);
  const savedBook = () => page.evaluate(() => JSON.parse(localStorage.getItem('shelf-life.board.v1')!).books[0]);
  await expect.poll(savedBook).toMatchObject({
    title: 'Children of Ruin', author: 'Adrian Tchaikovsky', matchedWorkId: 'OL20079532W',
    coverSelection: { kind: 'open-library', workId: 'OL20079532W', coverId: 8750923 },
  });
  await page.reload();
  await expect(card).toBeVisible();
  expect(searches).toHaveLength(1);
});

test('AI-normalized titles and authors are saved and sent to Open Library lookup', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    Object.defineProperty(window, 'LanguageModel', {
      configurable: true,
      value: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => JSON.stringify({
            books: [{ title: 'The Spear Cuts Through Water', author: 'Simon Jimenez' }],
          }),
          destroy() {},
        }),
      },
    });
  });
  const inputs: unknown[] = [];
  await page.route('https://openlibrary.org/search.json?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    inputs.push({ title: params.get('title'), author: params.get('author') });
    await route.fulfill({ json: { docs: [] } });
  });
  await page.getByLabel('Book title and author in natural language').fill('The Spear Cuts Through Water: A Novel by Simon Jimenez');
  await page.getByRole('button', { name: '+ Add book' }).click();
  await expect(page.getByRole('article', { name: 'The Spear Cuts Through Water by Simon Jimenez' })).toBeVisible();
  await expect.poll(() => inputs).toEqual([{ title: 'The Spear Cuts Through Water', author: 'Simon Jimenez' }]);
  await page.reload();
  await expect(page.getByRole('article', { name: 'The Spear Cuts Through Water by Simon Jimenez' })).toBeVisible();
});

test('serial cover searches show waiting and spinning states and the editor retries with changed fields', async ({ page }) => {
  const inputs: { title: string; author: string }[] = [];
  const release = new Map<string, () => void>();
  await page.route('https://openlibrary.org/search.json?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const input = { title: params.get('title')!, author: params.get('author') ?? 'Unknown author' };
    inputs.push(input);
    await new Promise<void>((resolve) => release.set(input.title, resolve));
    await route.fulfill({ json: { docs: [] } });
  });
  await page.goto('/');
  for (const title of ['First', 'Second', 'Removed']) {
    await page.getByLabel('Book title and author in natural language').fill(title);
    await page.getByRole('button', { name: '+ Add book' }).click();
    await expect(page.getByRole('button', { name: '+ Add book' })).toBeEnabled();
  }
  const first = page.getByRole('article', { name: 'First by Unknown author', exact: true });
  const second = page.locator('.book-card').filter({ has: page.getByText('Second', { exact: true }) });
  await expect(first.getByRole('status', { name: 'Searching for cover: First' })).toBeVisible();
  await expect(first.locator('.cover-spinner')).toHaveCSS('animation-name', 'cover-spin');
  await expect(second.getByRole('status', { name: 'Processing book: Second' })).toBeVisible();
  await expect(second.locator('.chrome-spinner')).toHaveCSS('animation-name', 'cover-spin');
  await expect(second.locator('.cover-spinner')).toHaveCount(0);
  expect(inputs.map((input) => input.title)).toEqual(['First']);
  const removed = page.getByRole('article', { name: 'Removed', exact: true });
  await removed.hover();
  await removed.getByRole('button', { name: 'Remove Removed', exact: true }).click();
  release.get('First')!();
  await expect(second.getByRole('status', { name: 'Searching for cover: Second' })).toBeVisible();
  await expect.poll(() => inputs.map((input) => input.title)).toEqual(['First', 'Second']);
  release.get('Second')!();
  await expect(second.getByText('No match', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Choose cover/ })).toHaveCount(0);
  await first.hover();
  await first.getByRole('button', { name: 'Edit First', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Book details', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Book name').fill('Corrected');
  await editor.getByLabel('Author', { exact: true }).fill('Correct author');
  await editor.getByRole('button', { name: 'Retry cover search' }).click();
  await expect(editor.getByRole('button', { name: 'Retry cover search' })).toBeDisabled();
  await expect.poll(() => inputs.at(-1)).toEqual({ title: 'Corrected', author: 'Correct author' });
  expect(inputs).toHaveLength(3);
  release.get('Corrected')!();
  await expect(editor.getByText('No matching works found.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Corrected by Correct author', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shelf-life.board.v1')!).books[0]))
    .toMatchObject({ title: 'Corrected', author: 'Correct author' });
});

async function seed(page: Page) {
  let board = importBooks(createBoard(), 'Red edition | Author\nBlue edition | Other');
  board.books.forEach((book, index) => { book.coverSelection = {
    kind: 'open-library', workId: `OL${index + 1}W`, editionId: `OL${index + 1}M`, coverId: index + 1,
  }; });
  for (const book of board.books) board = moveBook(board, book.id, 'tier-S');
  await page.addInitScript((snapshot) => localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot)), board);
}
async function fixtures(page: Page) {
  await page.goto('/');
  const data = await page.evaluate(() => ['#ee2222', '#2222ee'].map((color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 180; canvas.height = 240;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color; context.fillRect(0, 0, 180, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.route('https://covers.openlibrary.org/**', async (route) => {
    const red = route.request().url().includes('/1-');
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(data[red ? 0 : 1], 'base64'),
      headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}
async function jpegColors(page: Page, bytes: Buffer) {
  return page.evaluate(async (base64) => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0; let blue = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset] > 180 && pixels[offset + 1] < 80 && pixels[offset + 2] < 80) red++;
      if (pixels[offset + 2] > 180 && pixels[offset] < 80 && pixels[offset + 1] < 80) blue++;
    }
    return { red, blue };
  }, bytes.toString('base64'));
}

test('own-cover card matches cover dimensions on desktop and narrow screens', async ({ page }) => {
  await page.goto('/');
  const board = importBooks(createBoard(), 'Custom cover | Author');
  board.books[0].coverSelection = { kind: 'placeholder' };
  await page.evaluate((snapshot) => localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot)), board);
  await page.reload();
  await page.getByRole('article', { name: 'Custom cover by Author', exact: true }).hover();
  await page.getByRole('button', { name: 'Edit Custom cover', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Book details', exact: true });
  for (const width of [1360, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await editor.evaluate((dialog) => {
      const upload = dialog.querySelector<HTMLElement>('.cover-upload')!;
      const cover = dialog.querySelector('.cover-choice img')!.getBoundingClientRect();
      const bounds = upload.getBoundingClientRect();
      return {
        widthDifference: Math.abs(bounds.width - cover.width),
        heightDifference: Math.abs(bounds.height - cover.height),
        overflow: upload.scrollHeight - upload.clientHeight,
        buttonsFit: Array.from(upload.querySelectorAll('button')).every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.top >= bounds.top && rect.bottom <= bounds.bottom &&
            rect.left >= bounds.left && rect.right <= bounds.right && button.scrollWidth <= button.clientWidth;
        }),
      };
    });
    expect(dimensions.widthDifference).toBeLessThan(1);
    expect(dimensions.heightDifference).toBeLessThan(1);
    expect(dimensions.overflow).toBeLessThanOrEqual(1);
    expect(dimensions.buttonsFit).toBe(true);
  }
});

for (const method of ['upload', 'paste'] as const) {
  test(`custom cover ${method} stays local, resizes, persists, and appears in the JPEG`, async ({ page, context }, testInfo) => {
    await page.goto('/');
    let board = importBooks(createBoard(), 'Custom cover | Author');
    board.books[0].coverSelection = { kind: 'placeholder' };
    board = moveBook(board, board.books[0].id, 'tier-S');
    await page.evaluate((snapshot) => localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot)), board);
    await page.reload();
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/u.test(request.url()) && new URL(request.url()).origin !== new URL(page.url()).origin) {
        externalRequests.push(request.url());
      }
    });
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 2400; canvas.height = 3600;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ee2222'; context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    });
    const card = page.getByRole('article', { name: 'Custom cover by Author', exact: true });
    await card.hover();
    await card.getByRole('button', { name: 'Edit Custom cover', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Book details', exact: true });
    if (method === 'upload') {
      const chooser = page.waitForEvent('filechooser');
      await editor.getByRole('button', { name: 'Upload photo', exact: true }).click();
      await (await chooser).setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
    } else {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate(async (dataUrl) => {
        const blob = await (await fetch(dataUrl)).blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }, png);
      await editor.getByRole('button', { name: 'Paste image', exact: true }).click();
      await expect(editor.getByRole('group', { name: 'Paste cover image' })).toBeFocused();
      await page.keyboard.press('ControlOrMeta+V');
    }
    await expect(editor).toHaveCount(0);
    await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    const dimensions = await card.locator('img').evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    });
    expect(dimensions).toEqual([800, 1200]);
    await page.reload();
    await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await card.hover();
    await card.getByRole('button', { name: 'Edit Custom cover', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'Select your uploaded cover', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export JPEG/ }).click();
    const download = await downloaded;
    const file = testInfo.outputPath(`custom-${method}.jpg`);
    await download.saveAs(file);
    expect((await jpegColors(page, await readFile(file))).red).toBeGreaterThan(20_000);
    expect(externalRequests).toEqual([]);
  });
}

test('exports distinct verified edition artwork, reuses bytes, and persists selections', async ({ page }, testInfo) => {
  await fixtures(page);
  const metadata: string[] = [];
  page.on('request', (request) => { if (request.url().startsWith('https://openlibrary.org/')) metadata.push(request.url()); });
  const largeImages: string[] = [];
  page.on('request', (request) => { if (request.url().includes('-L.jpg')) largeImages.push(request.url()); });
  await seed(page); await page.reload();
  await expect(page.getByRole('region', { name: 'Tier S', exact: true }).locator('img').first()).toHaveAttribute('src', /\/1-M.jpg/);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export JPEG/ }).click();
  const download = await downloaded;
  const file = testInfo.outputPath('distinct-covers.jpg');
  await download.saveAs(file);
  const bytes = await readFile(file);
  expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  const colors = await jpegColors(page, bytes);
  expect(colors.red).toBeGreaterThan(20_000);
  expect(colors.blue).toBeGreaterThan(20_000);
  expect(largeImages).toHaveLength(2);
  expect(metadata).toHaveLength(0);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shelf-life.board.v1')!).books[0].coverSelection.editionId)).toBe('OL1M');
});
test('uses the search cover and loads additional editions only through the editor button', async ({ page }, testInfo) => {
  await fixtures(page);
  let searchRequests = 0;
  await page.route('https://openlibrary.org/search.json?**', async (route) => {
    searchRequests++;
    await route.fulfill({ json: { docs: [{
      key: '/works/OL1W', title: 'Red edition', author_name: ['Author'], cover_i: 2,
    }] } });
  });
  let editionRequests = 0;
  await page.route('https://openlibrary.org/works/OL1W/editions.json?**', async (route) => {
    editionRequests++;
    await route.fulfill({ json: { size: 2, entries: [
      { key: '/books/OL1M', title: 'Red edition', publish_date: '2000', covers: [2] },
      { key: '/books/OL2M', title: 'Red edition', publish_date: '2025', covers: [1] },
    ] } });
  });
  let board = importBooks(createBoard(), 'Red book: A Novel | A. Writer');
  board = moveBook(board, board.books[0].id, 'tier-S');
  await page.addInitScript((snapshot) => localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot)), board);
  await page.reload();
  const ranked = page.getByRole('region', { name: 'Tier S', exact: true });
  await expect(ranked.locator('img')).toHaveAttribute('src', /\/2-M.jpg/);
  await expect(ranked.getByRole('article')).toHaveAccessibleName('Red edition by Author');
  expect(searchRequests).toBe(1);
  expect(editionRequests).toBe(0);
  await ranked.getByRole('article').hover();
  await page.getByRole('button', { name: 'Edit Red edition' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Find additional editions and covers' })).toBeVisible();
  expect(editionRequests).toBe(0);
  await dialog.getByRole('button', { name: 'Find additional editions and covers' }).click();
  await expect(dialog.getByRole('button', { name: /Select edition OL2M/ })).toBeVisible();
  expect(editionRequests).toBe(1);
  await dialog.getByRole('button', { name: /Select edition OL2M/ }).click();
  await ranked.getByRole('article').hover();
  await page.getByRole('button', { name: 'Edit Red edition' }).click();
  await dialog.getByRole('button', { name: 'Find additional editions and covers' }).click();
  await expect(dialog.getByText('All available editions loaded.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'More editions and covers' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /^Explore editions/ })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Edit book' })).toHaveCount(0);
  await expect(dialog.locator('label')).toHaveCount(0);
  const name = dialog.getByPlaceholder('Book name');
  const author = dialog.getByPlaceholder('Author name');
  await expect(name).toHaveCSS('font-size', '32px');
  await expect(author).toHaveCSS('font-size', '18px');
  await expect(author).toHaveCSS('color', 'rgb(115, 119, 109)');
  for (const input of [name, author]) {
    await dialog.getByRole('button', { name: 'Close book editor' }).focus();
    await input.hover();
    for (const side of ['top', 'right', 'bottom', 'left']) {
      await expect(input).toHaveCSS(`border-${side}-color`, 'rgba(0, 0, 0, 0)');
    }
    await expect(input).toHaveCSS('background-color', 'rgb(243, 241, 235)');
    await input.click();
    await expect(input).toHaveCSS('border-top-width', '1px');
    await expect(input).toHaveCSS('border-top-color', 'rgb(129, 146, 120)');
    await expect(input).toHaveCSS('outline-style', 'none');
    await expect(input).toHaveCSS('background-color', 'rgb(243, 241, 235)');
    await dialog.getByRole('button', { name: 'Close book editor' }).focus();
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    if (input === author) await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS('outline-style', 'none');
    await expect(input).toHaveCSS('border-top-width', '1px');
  }
  await expect(dialog.getByText(/Retry saves|Automatic selection uses/)).toHaveCount(0);
  const gallery = dialog.getByRole('group', { name: 'Cover gallery' });
  await expect(gallery.locator('img')).toHaveCount(3);
  await expect(gallery.locator('img[src*="/1-M.jpg"]')).toHaveCount(1);
  await expect(gallery.locator('img[src*="/2-M.jpg"]')).toHaveCount(1);
  await expect(gallery.getByRole('button', { name: /Select edition OL2M/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(gallery.getByRole('button', { name: 'Select placeholder cover' }).locator('img')).toBeVisible();
  await expect(gallery.getByRole('button', { name: /Select edition OL2M/ }).locator('..')).toHaveText('2025');
  await name.click();
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  if (!bounds) throw new Error('Book editor is not visible.');
  await page.mouse.click(bounds.x + 8, bounds.y + 200);
  await expect(dialog).toBeVisible();
  await page.mouse.move(bounds.x + 8, bounds.y + 200);
  await page.mouse.down();
  await page.mouse.move(20, 50);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(20, 50);
  await expect(dialog).toHaveCount(0);
  await ranked.getByRole('article').hover();
  await page.getByRole('button', { name: 'Edit Red edition' }).click();
  await dialog.getByRole('button', { name: 'Close book editor' }).click();
  await expect(dialog).toHaveCount(0);
  await ranked.getByRole('article').hover();
  await page.getByRole('button', { name: 'Edit Red edition' }).click();
  await expect(dialog.getByRole('button', { name: /Select edition OL2M/ })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: /Select edition OL2M/ }).locator('img').click();
  await expect(dialog).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export JPEG/ }).click();
  const file = testInfo.outputPath('automatic-edition.jpg');
  await (await downloaded).saveAs(file);
  const colors = await jpegColors(page, await readFile(file));
  expect(colors.red).toBeGreaterThan(20_000);
  expect(colors.blue).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shelf-life.board.v1')!).books[0].coverSelection.editionId)).toBe('OL2M');
});
test('requires explicit placeholder export when selected artwork fails', async ({ page }) => {
  await fixtures(page);
  await page.route('https://covers.openlibrary.org/**', async (route) => {
    await route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await seed(page); await page.reload();
  await page.getByRole('button', { name: /Export JPEG/ }).click();
  await expect(page.getByRole('alert')).toContainText('Red edition');
  await expect(page.getByRole('alert')).toContainText('Blue edition');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export with placeholders for failed covers' }).click();
  expect((await downloaded).suggestedFilename()).toBe('my-book-tier-list.jpg');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('bounds stalled image preflight and allows an explicit placeholder decision', async ({ page }) => {
  await fixtures(page);
  await page.route('https://covers.openlibrary.org/**', async (route) => {
    if (route.request().url().includes('-L.jpg')) {
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      await route.abort();
    } else await route.fallback();
  });
  await seed(page); await page.reload();
  await page.getByRole('button', { name: /Export JPEG/ }).click();
  await expect(page.getByRole('alert')).toContainText('could not be embedded', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Retry export' })).toBeVisible();
});
test('late lookup results preserve placement and cannot change an export snapshot', async ({ page }, testInfo) => {
  await fixtures(page);
  let releaseLookup!: () => void;
  let startedPreflight!: () => void;
  let releasePreflight!: () => void;
  const lookupGate = new Promise<void>((resolve) => { releaseLookup = resolve; });
  const preflightStarted = new Promise<void>((resolve) => { startedPreflight = resolve; });
  const preflightGate = new Promise<void>((resolve) => { releasePreflight = resolve; });
  await page.route('https://openlibrary.org/search.json?**', async (route) => {
    await lookupGate;
    await route.fulfill({ json: { docs: [{
      key: '/works/OL1W', title: 'Red edition', author_name: ['Author'], cover_i: 1,
    }] } });
  });
  await page.route('https://covers.openlibrary.org/**', async (route) => {
    if (route.request().url().includes('-L.jpg')) { startedPreflight(); await preflightGate; }
    await route.fallback();
  });
  let board = importBooks(createBoard(), 'Red edition | Author\nBlue edition | Other');
  board.books[1].coverSelection = { kind: 'open-library', workId: 'OL2W', editionId: 'OL2M', coverId: 2 };
  for (const book of board.books) board = moveBook(board, book.id, 'tier-S');
  await page.addInitScript((snapshot) => localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot)), board);
  await page.reload();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export JPEG/ }).click();
  await preflightStarted;
  await expect(page.getByText(/placeholders for 1 unresolved/)).toBeVisible();
  releaseLookup();
  const ranked = page.getByRole('region', { name: 'Tier S', exact: true });
  await expect(ranked.locator('img').first()).toHaveAttribute('src', /\/1-M.jpg/);
  await expect(ranked.getByRole('article').first()).toHaveAccessibleName('Red edition by Author');
  releasePreflight();
  const file = testInfo.outputPath('snapshot-covers.jpg');
  await (await downloaded).saveAs(file);
  const colors = await jpegColors(page, await readFile(file));
  expect(colors.red).toBe(0);
  expect(colors.blue).toBeGreaterThan(20_000);
});
