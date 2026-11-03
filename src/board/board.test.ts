import { describe, expect, it } from 'vitest';
import {
  GALLERY,
  addTier,
  booksAt,
  clearGallery,
  clearRankings,
  createBoard,
  deleteTier,
  importBooks,
  locationOf,
  moveBook,
  queueBook,
  removeBook,
  reorderTier,
  resolveQueuedBooks,
  updateBook,
  updateTier,
} from './board';

describe('book import', () => {
  it('expands a pending batch atomically in gallery order, preserving its first ID and duplicates', () => {
    let board = importBooks(createBoard(), 'Existing');
    board = queueBook(board, 'Two books');
    board = queueBook(board, 'Later batch');
    const id = board.gallery[1];
    const entries = [
      { title: 'Dune', author: '' },
      { title: 'Dune', author: '' },
    ];
    const next = resolveQueuedBooks(board, id, entries);
    expect(next.books).toHaveLength(4);
    expect(next.books[1]).toEqual({
      id,
      title: 'Dune',
      author: 'Unknown author',
    });
    expect(next.gallery).toEqual([board.gallery[0], id, next.books[3].id, board.gallery[2]]);
    expect(board.books[1].pendingInput).toBe('Two books');
    expect(() => resolveQueuedBooks(board, id, [])).toThrow('No books');
    expect(() => resolveQueuedBooks(board, id, [...entries, { title: '', author: '' }])).toThrow('empty');
    expect(() => resolveQueuedBooks(next, id, entries)).toThrow('Pending book not found');
  });

  it('keeps a ranked pending card and its artwork, placing the other extracted books in the gallery', () => {
    let board = queueBook(createBoard(), 'Two books');
    const id = board.gallery[0];
    board = moveBook(board, id, 'tier-S');
    board.books[0].coverSelection = { kind: 'placeholder' };
    const next = resolveQueuedBooks(board, id, [
      { title: 'Dune', author: 'Frank Herbert' },
      { title: 'Piranesi', author: '' },
    ]);
    expect(next.tiers).toEqual(board.tiers);
    expect(next.books[0]).toEqual({
      id,
      title: 'Dune',
      author: 'Frank Herbert',
      coverSelection: { kind: 'placeholder' },
    });
    expect(next.gallery).toEqual([next.books[1].id]);
    expect(next.books[1].coverSelection).toBeUndefined();
  });

  it('queues the exact input and resolves in place without losing ranking or selected artwork', () => {
    const input = '  Dune: A Novel by Frank  Herbert  ';
    let board = queueBook(createBoard(), input);
    const id = board.gallery[0];
    expect(board.books[0]).toMatchObject({
      id,
      title: input,
      pendingInput: input,
    });
    const duplicate = queueBook(board, input.toLowerCase());
    expect(duplicate.books).toHaveLength(2);
    expect(duplicate.books[1].pendingInput).toBe(input.toLowerCase());
    expect(duplicate.books[1].id).not.toBe(id);
    expect(() => queueBook(board, '   ')).toThrow('title cannot be empty');
    board = moveBook(board, id, 'tier-S');
    board.books[0].coverSelection = { kind: 'placeholder' };
    const next = updateBook(board, id, {
      title: 'Dune',
      author: 'Frank Herbert',
    });
    expect(next.books[0]).toEqual({
      id,
      title: 'Dune',
      author: 'Frank Herbert',
      coverSelection: { kind: 'placeholder' },
    });
    expect(next.tiers[0].bookIds).toEqual([id]);
    expect(board.books[0].pendingInput).toBe(input);
  });

  it('imports structured AI results without interpreting title punctuation as separators', () => {
    const board = importBooks(createBoard(), [{ title: ' Title | Subtitle ', author: '' }]);
    expect(board.books[0]).toMatchObject({
      title: 'Title | Subtitle',
      author: 'Unknown author',
    });
    const next = importBooks(board, [
      { title: 'New', author: '' },
      { title: 'title | subtitle', author: 'Unknown author' },
    ]);
    expect(next.books).toHaveLength(3);
    expect(board.books).toHaveLength(1);
    expect(() => importBooks(board, [{ title: ' ', author: 'Author' }])).toThrow('title cannot be empty');
    expect(() => importBooks(board, [])).toThrow('Enter at least one');
  });

  it('parses optional authors, whitespace, and blank lines', () => {
    const board = importBooks(createBoard(), '\n  Dune  | Frank   Herbert \r\n Piranesi \n\n');
    expect(board.books.map(({ title, author }) => ({ title, author }))).toEqual([
      { title: 'Dune', author: 'Frank Herbert' },
      { title: 'Piranesi', author: 'Unknown author' },
    ]);
    expect(board.gallery).toEqual(board.books.map((book) => book.id));
  });

  it.each(['', '   \n', '| author', 'Title | Author | Extra'])('rejects invalid input %j', (text) => {
    expect(() => importBooks(createBoard(), text)).toThrow();
  });

  it('preserves exact and normalized duplicates within a batch as separate books', () => {
    const board = importBooks(createBoard(), 'Dune | Frank Herbert\nDune | Frank Herbert\n dune | FRANK   HERBERT');
    expect(board.books.map(({ title, author }) => ({ title, author }))).toEqual([
      { title: 'Dune', author: 'Frank Herbert' },
      { title: 'Dune', author: 'Frank Herbert' },
      { title: 'dune', author: 'FRANK HERBERT' },
    ]);
    expect(new Set(board.gallery).size).toBe(3);
    expect(board.gallery).toEqual(board.books.map((book) => book.id));
  });

  it('allows duplicates of ranked and unranked books without changing existing placements', () => {
    let board = importBooks(createBoard(), 'Dune | Frank Herbert\nPiranesi');
    board = moveBook(board, board.gallery[0], board.tiers[0].id);
    const next = importBooks(
      board,
      'New book\nDUNE | frank herbert\npiranesi | Unknown author\nDune | Different Author',
    );
    expect(next.books).toHaveLength(6);
    expect(next.tiers).toEqual(board.tiers);
    expect(next.gallery).toHaveLength(5);
    expect(board.books).toHaveLength(2);
  });
});

describe('board operations', () => {
  const populated = () => importBooks(createBoard(), 'One\nTwo\nThree');

  it('clears only gallery books without changing ranked books, artwork, or tier settings', () => {
    const original = populated();
    const [one, two, three] = original.gallery;
    original.books[1].coverSelection = { kind: 'placeholder' };
    const board = moveBook(original, two, 'tier-S');
    const next = clearGallery(board);
    expect(next.gallery).toEqual([]);
    expect(next.books).toEqual([board.books[1]]);
    expect(next.books[0]).toBe(board.books[1]);
    expect(next.tiers).toBe(board.tiers);
    expect(board.gallery).toEqual([one, three]);
    expect(board.books).toHaveLength(3);
    expect(clearGallery(next)).toEqual(next);
    expect(clearGallery(createBoard())).toEqual(createBoard());
    expect(clearGallery(original).books).toEqual([]);
  });

  it('clears every tier into the gallery in tier and book order without changing books or tier settings', () => {
    const original = populated();
    const [one, two, three] = original.gallery;
    original.books[0].coverSelection = { kind: 'placeholder' };
    let board = moveBook(original, two, 'tier-S');
    board = moveBook(board, one, 'tier-S');
    board = moveBook(board, three, 'tier-E');
    const next = clearRankings(board);
    expect(next.gallery).toEqual([two, one, three]);
    expect(next.books).toBe(board.books);
    expect(next.tiers).toEqual(board.tiers.map((tier) => ({ ...tier, bookIds: [] })));
    expect(board.gallery).toEqual([]);
    expect(board.tiers[0].bookIds).toEqual([two, one]);
    expect(board.tiers[5].bookIds).toEqual([three]);
    expect(clearRankings(next)).toEqual(next);
  });

  it('keeps existing gallery books first when clearing ranks and supports an empty board', () => {
    const original = populated();
    const [one, two, three] = original.gallery;
    const board = moveBook(moveBook(original, two, 'tier-S'), one, 'tier-A');
    expect(clearRankings(board).gallery).toEqual([three, two, one]);
    expect(clearRankings(createBoard())).toEqual(createBoard());
  });

  it('moves through gallery, empty tiers, and other tiers without mutating the original', () => {
    const original = populated();
    const [one, two, three] = original.gallery;
    const [s, a] = original.tiers;
    let board = moveBook(original, one, s.id);
    expect(board.gallery).toEqual([two, three]);
    expect(original.gallery).toEqual([one, two, three]);
    board = moveBook(board, two, s.id, 0);
    expect(booksAt(board, s.id)).toEqual([two, one]);
    board = moveBook(board, one, s.id, 0);
    expect(booksAt(board, s.id)).toEqual([one, two]);
    board = moveBook(board, one, a.id);
    expect(locationOf(board, one)).toBe(a.id);
    board = moveBook(board, one, GALLERY, 0);
    expect(board.gallery).toEqual([one, three]);
    expect(board.tiers.flatMap((tier) => tier.bookIds)).toEqual([two]);
  });

  it('moves books later in a row and removes books everywhere', () => {
    let board = populated();
    const [one, two, three] = board.gallery;
    board = moveBook(board, one, GALLERY, 2);
    expect(board.gallery).toEqual([two, three, one]);
    board = moveBook(board, three, board.tiers[0].id);
    board = removeBook(board, three);
    expect(board.books.map((book) => book.id)).toEqual([one, two]);
    expect(board.tiers[0].bookIds).toEqual([]);
    expect(removeBook(board, one).gallery).toEqual([two]);
  });

  it('supports tier settings and returns deleted tier books in order', () => {
    let board = populated();
    const [one, two, three] = board.gallery;
    const id = board.tiers[0].id;
    board = moveBook(moveBook(board, one, id), two, id);
    board = updateTier(board, id, { name: 'Favorites', color: '#abcdef' });
    expect(board.tiers[0]).toMatchObject({
      name: 'Favorites',
      color: '#abcdef',
    });
    expect(() => updateTier(board, id, { name: ' ' })).toThrow('empty');
    expect(() => updateTier(board, id, { color: 'red' })).toThrow('color');
    board = reorderTier(board, id, 1);
    expect(board.tiers[1].id).toBe(id);
    board = addTier(board);
    expect(board.tiers).toHaveLength(7);
    board = deleteTier(board, id);
    expect(board.gallery).toEqual([three, one, two]);
    while (board.tiers.length > 1) board = deleteTier(board, board.tiers[0].id);
    expect(() => deleteTier(board, board.tiers[0].id)).toThrow('at least one');
  });

  it('rejects invalid operations explicitly', () => {
    const board = populated();
    expect(() => moveBook(board, 'missing', GALLERY)).toThrow('found');
    expect(() => moveBook(board, board.gallery[0], 'missing')).toThrow('destination');
    expect(() => moveBook(board, board.gallery[0], GALLERY, -1)).toThrow('position');
    expect(() => reorderTier(board, board.tiers[0].id, -1)).toThrow('position');
    for (const index of [-1, board.tiers.length + 1, 0.5, NaN]) {
      expect(() => addTier(board, index)).toThrow('position');
    }
  });

  it('inserts tiers at the beginning, middle, and end without changing existing tiers', () => {
    const board = populated();
    for (const index of [0, 3, board.tiers.length]) {
      const next = addTier(board, index);
      expect(next.tiers[index]).toMatchObject({ name: 'New tier', bookIds: [] });
      expect(next.tiers.filter((_, position) => position !== index)).toEqual(board.tiers);
      expect(next.books).toBe(board.books);
      expect(next.gallery).toBe(board.gallery);
    }
  });

  it('blends neighboring colors for new tiers and uses the nearest color at the edges', () => {
    const board = createBoard();
    board.tiers = [
      { ...board.tiers[0], color: '#102030' },
      { ...board.tiers[1], color: '#304050' },
      { ...board.tiers[2], color: '#ffffff' },
    ];
    expect(addTier(board, 1).tiers[1].color).toBe('#203040');
    expect(addTier(board, 2).tiers[2].color).toBe('#98a0a8');
    expect(addTier(board, 0).tiers[0].color).toBe('#102030');
    expect(addTier(board).tiers[3].color).toBe('#ffffff');
    board.tiers = board.tiers.slice(0, 1);
    expect(addTier(board, 0).tiers[0].color).toBe('#102030');
    expect(addTier(board).tiers[1].color).toBe('#102030');
  });

  it('edits metadata without changing placement or cover and rejects invalid edits atomically', () => {
    const board = populated();
    const [one, two] = board.books;
    one.coverSelection = { kind: 'placeholder' };
    const next = updateBook(board, one.id, {
      title: '  New   name ',
      author: ' ',
    });
    expect(next.books[0]).toEqual({
      ...one,
      title: 'New name',
      author: 'Unknown author',
    });
    expect(board.books[0].title).toBe('One');
    expect(next.gallery).toEqual(board.gallery);
    expect(next.tiers).toEqual(board.tiers);
    expect(() => updateBook(board, one.id, { title: ' ', author: '' })).toThrow('empty');
    const duplicate = updateBook(board, one.id, {
      title: two.title,
      author: two.author,
    });
    expect(duplicate.books[0]).toEqual({
      ...one,
      title: two.title,
      author: two.author,
    });
    expect(duplicate.books[1]).toEqual(two);
    expect(duplicate.gallery).toEqual(board.gallery);
    expect(() => updateBook(board, 'missing', two)).toThrow('not found');
  });
});
