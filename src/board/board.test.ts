import { describe, expect, it } from 'vitest';
import {
  GALLERY, addTier, booksAt, createBoard, deleteTier, importBooks, locationOf,
  moveBook, queueBook, removeBook, reorderTier, updateBook, updateTier,
} from './board';

describe('book import', () => {
  it('queues the exact input and resolves in place without losing ranking or selected artwork', () => {
    const input = '  Dune: A Novel by Frank  Herbert  ';
    let board = queueBook(createBoard(), input);
    const id = board.gallery[0];
    expect(board.books[0]).toMatchObject({ id, title: input, pendingInput: input });
    expect(() => queueBook(board, input.toLowerCase())).toThrow('already');
    expect(() => queueBook(board, '   ')).toThrow('title cannot be empty');
    board = moveBook(board, id, 'tier-S');
    board.books[0].coverSelection = { kind: 'placeholder' };
    const next = updateBook(board, id, { title: 'Dune', author: 'Frank Herbert' });
    expect(next.books[0]).toEqual({ id, title: 'Dune', author: 'Frank Herbert', coverSelection: { kind: 'placeholder' } });
    expect(next.tiers[0].bookIds).toEqual([id]);
    expect(board.books[0].pendingInput).toBe(input);
  });

  it('imports structured AI results without interpreting title punctuation as separators', () => {
    const board = importBooks(createBoard(), [{ title: ' Title | Subtitle ', author: '' }]);
    expect(board.books[0]).toMatchObject({ title: 'Title | Subtitle', author: 'Unknown author' });
    expect(() => importBooks(board, [
      { title: 'New', author: '' }, { title: 'title | subtitle', author: 'Unknown author' },
    ])).toThrow('Book 2');
    expect(board.books).toHaveLength(1);
    expect(() => importBooks(board, [{ title: ' ', author: 'Author' }])).toThrow('title cannot be empty');
    expect(() => importBooks(board, [])).toThrow('Enter at least one');
  });

  it('parses optional authors, whitespace, and blank lines', () => {
    const board = importBooks(createBoard(), '\n  Dune  | Frank   Herbert \r\n Piranesi \n\n');
    expect(board.books.map(({ title, author }) => ({ title, author }))).toEqual([
      { title: 'Dune', author: 'Frank Herbert' }, { title: 'Piranesi', author: 'Unknown author' },
    ]);
    expect(board.gallery).toEqual(board.books.map((book) => book.id));
  });

  it.each(['', '   \n', '| author', 'Title | Author | Extra'])('rejects invalid input %j', (text) => {
    expect(() => importBooks(createBoard(), text)).toThrow();
  });

  it('rejects normalized duplicates within a batch atomically', () => {
    const board = createBoard();
    expect(() => importBooks(board, 'Dune | Frank Herbert\n dune | FRANK   HERBERT')).toThrow('Line 2');
    expect(board.books).toEqual([]);
  });

  it('checks ranked and unranked books while allowing different authors', () => {
    let board = importBooks(createBoard(), 'Dune | Frank Herbert\nPiranesi');
    board = moveBook(board, board.gallery[0], board.tiers[0].id);
    expect(() => importBooks(board, 'New book\nDUNE | frank herbert')).toThrow('already');
    expect(() => importBooks(board, 'piranesi | Unknown author')).toThrow('already');
    expect(importBooks(board, 'Dune | Different Author').books).toHaveLength(3);
    expect(board.books).toHaveLength(2);
  });
});

describe('board operations', () => {
  const populated = () => importBooks(createBoard(), 'One\nTwo\nThree');

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
    expect(board.tiers[0]).toMatchObject({ name: 'Favorites', color: '#abcdef' });
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
  });

  it('edits metadata without changing placement or cover and rejects invalid edits atomically', () => {
    const board = populated();
    const [one, two] = board.books;
    one.coverSelection = { kind: 'placeholder' };
    const next = updateBook(board, one.id, { title: '  New   name ', author: ' ' });
    expect(next.books[0]).toEqual({ ...one, title: 'New name', author: 'Unknown author' });
    expect(board.books[0].title).toBe('One');
    expect(next.gallery).toEqual(board.gallery);
    expect(next.tiers).toEqual(board.tiers);
    expect(() => updateBook(board, one.id, { title: ' ', author: '' })).toThrow('empty');
    expect(() => updateBook(board, one.id, { title: ' two ', author: 'unknown AUTHOR' })).toThrow('already');
    expect(() => updateBook(board, 'missing', two)).toThrow('not found');
  });
});
