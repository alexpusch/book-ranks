import type { CoverSelection } from './coverSelection';

export interface Book {
  id: string;
  title: string;
  author: string;
  pendingInput?: string;
  matchedWorkId?: string;
  coverSelection?: CoverSelection;
}

export type BookInput = Pick<Book, 'title' | 'author'>;

export interface Tier {
  id: string;
  name: string;
  color: string;
  bookIds: string[];
}

export interface Board {
  version: 1;
  books: Book[];
  gallery: string[];
  tiers: Tier[];
}

export const GALLERY = 'gallery';
export const UNKNOWN_AUTHOR = 'Unknown author';
const colors = ['#e5a295', '#e9bf88', '#e6d88f', '#bdcba2', '#a8c5c5', '#b7b4d1'];

export function createBoard(): Board {
  return {
    version: 1,
    books: [],
    gallery: [],
    tiers: ['S', 'A', 'B', 'C', 'D', 'E'].map((name, index) => ({
      id: `tier-${name}`,
      name,
      color: colors[index],
      bookIds: [],
    })),
  };
}

export function tidy(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

export function bookIdentity(book: Pick<Book, 'title' | 'author'>): string {
  return JSON.stringify([tidy(book.title).toLowerCase(), tidy(book.author || UNKNOWN_AUTHOR).toLowerCase()]);
}

export function importBooks(board: Board, input: string | BookInput[]): Board {
  const identities = new Set(board.books.map(bookIdentity));
  const entries: Omit<Book, 'id'>[] = [];
  const errors: string[] = [];
  const lines = typeof input === 'string' ? input.split(/\r?\n/u) : input;
  lines.forEach((line, index) => {
    if (typeof line === 'string' && !line.trim()) return;
    const [rawTitle, rawAuthor = '', ...extra] = typeof line === 'string' ? line.split('|') : [line.title, line.author];
    const title = tidy(rawTitle);
    const author = tidy(rawAuthor) || UNKNOWN_AUTHOR;
    const label = `${typeof input === 'string' ? 'Line' : 'Book'} ${index + 1}`;
    if (!title || extra.length) {
      errors.push(`${label}: ${typeof input === 'string' ? 'use Title | Author with a nonempty title and at most one |.' : 'the title cannot be empty.'}`);
      return;
    }
    const identity = bookIdentity({ title, author });
    if (identities.has(identity)) {
      errors.push(`${label}: "${title}" by ${author} is already in this list or batch.`);
      return;
    }
    identities.add(identity);
    entries.push({ title, author });
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!entries.length) throw new Error('Enter at least one book title.');
  const books = entries.map((entry) => ({ ...entry, id: `book-${crypto.randomUUID()}` }));
  return { ...board, books: [...board.books, ...books], gallery: [...board.gallery, ...books.map((book) => book.id)] };
}

export function queueBook(board: Board, input: string): Board {
  const next = importBooks(board, [{ title: input, author: '' }]);
  const id = next.gallery[next.gallery.length - 1];
  return { ...next, books: next.books.map((book) => book.id === id
    ? { ...book, title: input, pendingInput: input } : book) };
}

export function locationOf(board: Board, bookId: string): string {
  if (board.gallery.includes(bookId)) return GALLERY;
  const tier = board.tiers.find((item) => item.bookIds.includes(bookId));
  if (!tier) throw new Error('The book could not be found on the board.');
  return tier.id;
}

export function booksAt(board: Board, destination: string): string[] {
  if (destination === GALLERY) return board.gallery;
  const tier = board.tiers.find((item) => item.id === destination);
  if (!tier) throw new Error('The destination tier does not exist.');
  return tier.bookIds;
}

// The insertion index refers to the destination after removing the moving book.
export function moveBook(board: Board, bookId: string, destination: string, index?: number): Board {
  locationOf(board, bookId);
  booksAt(board, destination);
  const gallery = board.gallery.filter((id) => id !== bookId);
  const tiers = board.tiers.map((tier) => ({ ...tier, bookIds: tier.bookIds.filter((id) => id !== bookId) }));
  const result = { ...board, gallery, tiers };
  const target = booksAt(result, destination);
  const insertion = index ?? target.length;
  if (!Number.isInteger(insertion) || insertion < 0 || insertion > target.length) {
    throw new Error('Invalid book position.');
  }
  target.splice(insertion, 0, bookId);
  return result;
}

export function removeBook(board: Board, bookId: string): Board {
  locationOf(board, bookId);
  return {
    ...board,
    books: board.books.filter((book) => book.id !== bookId),
    gallery: board.gallery.filter((id) => id !== bookId),
    tiers: board.tiers.map((tier) => ({ ...tier, bookIds: tier.bookIds.filter((id) => id !== bookId) })),
  };
}

export function updateBook(board: Board, bookId: string, changes: Pick<Book, 'title' | 'author'>): Board {
  if (!board.books.some((book) => book.id === bookId)) throw new Error('Book not found.');
  const title = tidy(changes.title);
  const author = tidy(changes.author) || UNKNOWN_AUTHOR;
  if (!title) throw new Error('Book titles cannot be empty.');
  if (board.books.some((book) => book.id !== bookId && bookIdentity(book) === bookIdentity({ title, author }))) {
    throw new Error(`"${title}" by ${author} is already in this list.`);
  }
  return { ...board, books: board.books.map((book) => {
    if (book.id !== bookId) return book;
    const { pendingInput: _pendingInput, ...details } = book;
    return { ...details, title, author };
  }) };
}

export function addTier(board: Board): Board {
  return { ...board, tiers: [...board.tiers, { id: `tier-${crypto.randomUUID()}`, name: 'New tier', color: '#c7c4ba', bookIds: [] }] };
}

export function updateTier(board: Board, id: string, changes: { name?: string; color?: string }): Board {
  if (!board.tiers.some((tier) => tier.id === id)) throw new Error('Tier not found.');
  if (changes.name !== undefined && !tidy(changes.name)) throw new Error('Tier names cannot be empty.');
  if (changes.color !== undefined && !/^#[0-9a-f]{6}$/iu.test(changes.color)) throw new Error('Choose a valid tier color.');
  return { ...board, tiers: board.tiers.map((tier) => tier.id === id ? { ...tier, ...changes } : tier) };
}

export function deleteTier(board: Board, id: string): Board {
  if (board.tiers.length === 1) throw new Error('Keep at least one tier.');
  const tier = board.tiers.find((item) => item.id === id);
  if (!tier) throw new Error('Tier not found.');
  return { ...board, gallery: [...board.gallery, ...tier.bookIds], tiers: board.tiers.filter((item) => item.id !== id) };
}

export function reorderTier(board: Board, id: string, offset: -1 | 1): Board {
  const index = board.tiers.findIndex((tier) => tier.id === id);
  const destination = index + offset;
  if (index < 0 || destination < 0 || destination >= board.tiers.length) throw new Error('Invalid tier position.');
  const tiers = [...board.tiers];
  [tiers[index], tiers[destination]] = [tiers[destination], tiers[index]];
  return { ...board, tiers };
}

export type BoardChange = (operation: (board: Board) => Board) => boolean;
