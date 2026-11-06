import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { booksAt, createBoard, GALLERY, importBooks, moveBook, type Board } from '../src/board/board';

async function startDrag(page: Page, card: Locator) {
  await card.hover();
  const handle = await card.getByRole('button', { name: 'Drag Moving book', exact: true }).boundingBox();
  if (!handle) throw new Error('Drag handle is not visible.');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 10, handle.y + handle.height / 2, { steps: 3 });
}

async function savedBoard(page: Page): Promise<Board> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('shelf-life.board.v1')!));
}

for (const { source, targetCount } of [
  { source: GALLERY, targetCount: 2 },
  { source: 'tier-S', targetCount: 2 },
  { source: 'tier-S', targetCount: 4 },
]) {
  test(`dragging from ${source} through an interior gap stays near the pointer with ${targetCount} target books`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 1800 });
    let board = importBooks(
      createBoard(),
      ['Moving book', ...['First', 'Second', 'Third', 'Fourth'].slice(0, targetCount)].join('\n'),
    );
    board.books.forEach((book) => {
      book.coverSelection = { kind: 'placeholder' };
    });
    const movingId = board.gallery[0];
    const targetIds = board.gallery.slice(1);
    for (const id of targetIds) board = moveBook(board, id, 'tier-S');
    if (source === 'tier-S') board = moveBook(board, movingId, source);
    await page.addInitScript((snapshot) => {
      localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot));
    }, board);
    await page.goto('/');
    const target = page.locator('[data-zone="tier-S"]');
    const first = await target.locator(`[data-book-id="${targetIds[0]}"]`).boundingBox();
    const second = await target.locator(`[data-book-id="${targetIds[1]}"]`).boundingBox();
    if (!first || !second) throw new Error('Target cards are not visible.');
    await startDrag(page, page.locator(`[data-book-id="${movingId}"]`));
    await page.mouse.move(first.x + 25, first.y + 40, { steps: 16 });
    await expect
      .poll(async () => Math.round((await target.locator('.is-dragging').boundingBox())!.x))
      .toBe(Math.round(first.x));
    const zone = await target.boundingBox();
    if (!zone) throw new Error('Target zone is not visible.');
    await page.mouse.move(second.x - 6, zone.y + 60, { steps: 8 });
    await expect
      .poll(async () => Math.round((await target.locator('.is-dragging').boundingBox())!.x))
      .toBe(Math.round(second.x));
    expect(await savedBoard(page)).toEqual(board);
    await page.mouse.up();
    await expect
      .poll(async () => booksAt(await savedBoard(page), 'tier-S'))
      .toEqual([targetIds[0], movingId, ...targetIds.slice(1)]);
  });
}

for (const source of [GALLERY, 'tier-S']) {
  test(`cards keep their dimensions while dragging from ${source} over different-height books`, async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 1800 });
    let board = importBooks(createBoard(), [
      { title: 'Moving book', author: 'An author' },
      { title: 'A longer book title that occupies several lines', author: 'Another author' },
    ]);
    board.books.forEach((book) => {
      book.coverSelection = { kind: 'placeholder' };
    });
    const movingId = board.gallery[0];
    for (const id of board.gallery.slice(1)) board = moveBook(board, id, 'tier-S');
    if (source === 'tier-S') board = moveBook(board, movingId, source, 0);
    await page.addInitScript((snapshot) => {
      localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot));
    }, board);
    await page.goto('/');
    const target = page.locator('[data-zone="tier-S"]');
    const positions = await target.locator('[data-book-id]').evaluateAll((cards) =>
      cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return { x: rect.x + 25, y: rect.y + 40 };
      }),
    );
    await page.evaluate(() => {
      const original = new Map(
        Array.from(document.querySelectorAll<HTMLElement>('[data-book-id]')).map((card) => {
          const rect = card.getBoundingClientRect();
          return [card.dataset.bookId!, { width: rect.width, height: rect.height }];
        }),
      );
      const failures: string[] = [];
      let running = true;
      const sample = () => {
        for (const card of document.querySelectorAll<HTMLElement>('[data-book-id]')) {
          const before = original.get(card.dataset.bookId!)!;
          const rect = card.getBoundingClientRect();
          if (Math.abs(rect.width - before.width) > 1 || Math.abs(rect.height - before.height) > 1)
            failures.push(
              `${card.getAttribute('aria-label')}: ${before.width}x${before.height} -> ${rect.width}x${rect.height}; ${getComputedStyle(card).transform}`,
            );
        }
        if (running) requestAnimationFrame(sample);
      };
      Object.assign(window, {
        finishSizeCheck: () => {
          running = false;
          return failures;
        },
      });
      requestAnimationFrame(sample);
    });
    await startDrag(page, page.locator(`[data-book-id="${movingId}"]`));
    for (const position of [...positions, ...[...positions].reverse()]) {
      await page.mouse.move(position.x, position.y, { steps: 16 });
    }
    const failures = await page.evaluate(() => {
      const finish = Reflect.get(window, 'finishSizeCheck') as () => string[];
      return finish().slice(0, 5);
    });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(failures).toEqual([]);
  });
}

for (const source of [GALLERY, 'tier-A']) {
  for (const index of [0, 3, 9]) {
    test(`drag from ${source} previews and saves position ${index} in a new rank`, async ({ page }) => {
      await page.setViewportSize({ width: 1360, height: 1800 });
      let board = importBooks(createBoard(), [
        { title: 'Moving book', author: '' },
        ...Array.from({ length: 10 }, (_, i) => ({ title: `Target ${i}`, author: '' })),
      ]);
      board.books.forEach((book) => {
        book.coverSelection = { kind: 'placeholder' };
      });
      const movingId = board.gallery[0];
      for (const id of board.gallery.slice(1)) board = moveBook(board, id, 'tier-S');
      if (source !== GALLERY) board = moveBook(board, movingId, source);
      await page.addInitScript((snapshot) => {
        if (!localStorage.getItem('shelf-life.board.v1'))
          localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot));
      }, board);
      await page.goto('/');
      const target = page.locator('[data-zone="tier-S"]');
      const originalOrder = booksAt(board, 'tier-S');
      const targetCard = target.locator(`[data-book-id="${originalOrder[index]}"]`);
      const bounds = await targetCard.boundingBox();
      const zoneBounds = await target.boundingBox();
      if (!bounds || !zoneBounds) throw new Error('Target card is not visible.');
      await startDrag(page, page.locator(`[data-book-id="${movingId}"]`));
      await page.mouse.move(bounds.x + bounds.width / 4, bounds.y + 35, { steps: 16 });
      const placeholder = target.locator('.is-dragging');
      await expect(placeholder).toHaveAttribute('data-book-id', movingId);
      await expect(placeholder).toHaveCSS('opacity', '0.3');
      await expect
        .poll(async () => {
          const slot = await placeholder.boundingBox();
          const zone = await target.boundingBox();
          return slot && zone && { x: Math.round(slot.x), y: Math.round(slot.y - zone.y) };
        })
        .toEqual({ x: Math.round(bounds.x), y: Math.round(bounds.y - zoneBounds.y) });
      expect(await savedBoard(page)).toEqual(board);
      await page.mouse.up();
      const expected = [...originalOrder];
      expected.splice(index, 0, movingId);
      await expect.poll(async () => booksAt(await savedBoard(page), 'tier-S')).toEqual(expected);
      await expect(page.locator('.is-dragging')).toHaveCount(0);
      await page.reload();
      await expect(target.locator('[data-book-id]')).toHaveCount(expected.length);
      expect(
        await target
          .locator('[data-book-id]')
          .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-book-id'))),
      ).toEqual(expected);
    });
  }
}

for (const ending of ['cancel', 'outside']) {
  test(`cross-rank preview is not saved on ${ending}`, async ({ page }) => {
    const board = importBooks(createBoard(), 'Moving book\nOther book');
    await page.addInitScript((snapshot) => {
      localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot));
    }, board);
    await page.goto('/');
    await startDrag(page, page.locator(`[data-book-id="${board.gallery[0]}"]`));
    const target = page.locator('[data-zone="tier-S"]');
    const bounds = await target.boundingBox();
    if (!bounds) throw new Error('Target zone is not visible.');
    await page.mouse.move(bounds.x + 50, bounds.y + 40, { steps: 16 });
    await expect(target.locator('.is-dragging')).toHaveCount(1);
    if (ending === 'cancel') await page.keyboard.press('Escape');
    else await page.mouse.move(5, 5, { steps: 16 });
    await page.mouse.up();
    await expect(target.getByRole('article')).toHaveCount(0);
    await expect(page.locator('.gallery-zone [data-book-id]')).toHaveCount(2);
    expect(await savedBoard(page)).toEqual(board);
  });
}

test('a cross-rank placeholder follows reordering and moving to the end of the destination', async ({ page }) => {
  let board = importBooks(createBoard(), 'Moving book\nFirst\nSecond\nThird');
  const movingId = board.gallery[0];
  for (const id of board.gallery.slice(1)) board = moveBook(board, id, 'tier-S');
  await page.addInitScript((snapshot) => {
    localStorage.setItem('shelf-life.board.v1', JSON.stringify(snapshot));
  }, board);
  await page.goto('/');
  const target = page.locator('[data-zone="tier-S"]');
  const first = await target.getByRole('article').first().boundingBox();
  const third = await target.getByRole('article', { name: 'Third by Unknown author', exact: true }).boundingBox();
  if (!first) throw new Error('Target card is not visible.');
  if (!third) throw new Error('Third card is not visible.');
  await startDrag(page, page.locator(`[data-book-id="${movingId}"]`));
  await page.mouse.move(first.x + 20, first.y + 35, { steps: 16 });
  await expect(target.locator('.is-dragging')).toHaveCount(1);
  const currentZone = await target.boundingBox();
  if (!currentZone) throw new Error('Target zone is not visible.');
  await page.mouse.move(third.x + 20, currentZone.y + 55, { steps: 16 });
  await expect
    .poll(async () => {
      const placeholder = await target.locator('.is-dragging').boundingBox();
      return placeholder && Math.round(placeholder.x);
    })
    .toBe(Math.round(third.x));
  const zone = await target.boundingBox();
  if (!zone) throw new Error('Target zone is not visible.');
  await page.mouse.move(zone.x + zone.width - 20, zone.y + 35, { steps: 16 });
  await expect
    .poll(async () => Math.round((await target.locator('.is-dragging').boundingBox())!.x))
    .toBe(Math.round(third.x + (third.x - first.x) / 2));
  expect(await savedBoard(page)).toEqual(board);
  await page.mouse.up();
  await expect
    .poll(async () => booksAt(await savedBoard(page), 'tier-S'))
    .toEqual([...booksAt(board, 'tier-S'), movingId]);
});
