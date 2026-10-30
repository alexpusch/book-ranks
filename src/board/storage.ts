import { bookIdentity, createBoard, GALLERY, type Board } from './board';
import { validateSelection } from './coverSelection';
import { workPattern } from '../integrations/openLibrary/types';

export const STORAGE_KEY = 'shelf-life.board.v1';
const invalidMessage = 'Saved list could not be loaded. Your saved data has not been overwritten. Reset saved data to start fresh.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText);
}

export function validateBoard(value: unknown): Board {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.books) ||
    !Array.isArray(value.tiers) || !value.tiers.length || !isStringArray(value.gallery)) {
    throw new Error('Unsupported or malformed saved list.');
  }
  const books = value.books.map((book: unknown) => {
    if (!isRecord(book) || !isText(book.id) || !isText(book.title) || !isText(book.author)) {
      throw new Error('Invalid saved book.');
    }
    if (book.matchedWorkId !== undefined && (typeof book.matchedWorkId !== 'string' || !workPattern.test(book.matchedWorkId))) {
      throw new Error('Invalid saved matched work.');
    }
    if (book.pendingInput !== undefined && (!isText(book.pendingInput) || book.pendingInput !== book.title || book.matchedWorkId !== undefined)) {
      throw new Error('Invalid saved pending book.');
    }
    return { id: book.id, title: book.title, author: book.author,
      ...(typeof book.pendingInput === 'string' ? { pendingInput: book.pendingInput } : {}),
      ...(typeof book.matchedWorkId === 'string' ? { matchedWorkId: book.matchedWorkId } : {}),
      ...(book.coverSelection !== undefined ? { coverSelection: validateSelection(book.coverSelection) } : {}) };
  });
  const tiers = value.tiers.map((tier: unknown) => {
    if (!isRecord(tier) || !isText(tier.id) || !isText(tier.name) ||
      typeof tier.color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(tier.color) || !isStringArray(tier.bookIds)) {
      throw new Error('Invalid saved tier.');
    }
    return { id: tier.id, name: tier.name, color: tier.color, bookIds: [...tier.bookIds] };
  });
  const ids = [...books.map((book) => book.id), ...tiers.map((tier) => tier.id), GALLERY];
  if (new Set(ids).size !== ids.length || new Set(books.map(bookIdentity)).size !== books.length) {
    throw new Error('Duplicate saved identifiers or books.');
  }
  const placements = [...value.gallery, ...tiers.flatMap((tier) => tier.bookIds)];
  const bookIds = new Set(books.map((book) => book.id));
  if (placements.length !== books.length || new Set(placements).size !== placements.length ||
    placements.some((id) => !bookIds.has(id))) {
    throw new Error('Invalid saved book placements.');
  }
  return { version: 1, books, tiers, gallery: [...value.gallery] };
}

export interface LoadedBoard {
  board: Board;
  warning: string | null;
  blocked: boolean;
}

export function loadBoard(): LoadedBoard {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return { board: raw === null ? createBoard() : validateBoard(JSON.parse(raw)), warning: null, blocked: false };
  } catch (error) {
    return {
      board: createBoard(),
      warning: `${invalidMessage} ${error instanceof Error ? error.message : 'Storage is unavailable.'}`,
      blocked: true,
    };
  }
}

export function saveBoard(board: Board): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
}

export function resetSavedBoard(): Board {
  const board = createBoard();
  saveBoard(board);
  return board;
}
