import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard, importBooks, moveBook, queueBook } from './board';
import { STORAGE_KEY, loadBoard, resetSavedBoard, saveBoard, validateBoard } from './storage';
import { MAX_LOCAL_COVER_LENGTH } from './coverSelection';

beforeEach(() => localStorage.clear());

describe('browser persistence', () => {
  it('round-trips exact pending input and rejects malformed pending entries', () => {
    const board = queueBook(createBoard(), '  Dune: A Novel by Frank Herbert  ');
    saveBoard(board);
    expect(loadBoard()).toMatchObject({ board, blocked: false });
    for (const pendingInput of [null, 12, '', '  ', 'different input']) {
      expect(() => validateBoard({ ...board, books: [{ ...board.books[0], pendingInput }] })).toThrow('pending book');
    }
    expect(() => validateBoard({ ...board, books: [{ ...board.books[0], matchedWorkId: 'OL1W' }] })).toThrow('pending book');
  });

  it('round-trips local artwork and rejects unsafe or oversized local cover sources', () => {
    const board = importBooks(createBoard(), 'Dune');
    const selection = { kind: 'local' as const, dataUrl: 'data:image/jpeg;base64,Y292ZXI=' };
    board.books[0].coverSelection = selection;
    saveBoard(board);
    expect(loadBoard()).toMatchObject({ board, blocked: false });
    for (const dataUrl of ['https://example.com/cover.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', '',
      `data:image/jpeg;base64,${'A'.repeat(MAX_LOCAL_COVER_LENGTH)}`]) {
      expect(() => validateBoard({ ...board, books: [{ ...board.books[0], coverSelection: { kind: 'local', dataUrl } }] }))
        .toThrow('cover selection');
    }
  });
  it('starts empty and round-trips the complete board', () => {
    expect(loadBoard()).toEqual({ board: createBoard(), warning: null, blocked: false });
    let board = importBooks(createBoard(), 'Dune | Frank Herbert\nPiranesi');
    board = moveBook(board, board.gallery[0], board.tiers[0].id);
    saveBoard(board);
    expect(loadBoard().board).toEqual(board);
  });

  it.each(['not json', '{"version":2}', 'null', '{"version":1,"books":[],"tiers":[]}'])(
    'blocks persistence of invalid saved data %s', (raw) => {
      localStorage.setItem(STORAGE_KEY, raw);
      expect(loadBoard()).toMatchObject({ blocked: true, warning: expect.stringContaining('not been overwritten') });
      expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    },
  );

  it('validates identifiers, duplicate books, and exactly-once placement', () => {
    const board = importBooks(createBoard(), 'One\nTwo');
    const id = board.gallery[0];
    expect(() => validateBoard({ ...board, gallery: [] })).toThrow('placements');
    expect(() => validateBoard({ ...board, gallery: [id, id] })).toThrow('placements');
    expect(() => validateBoard({ ...board, gallery: ['missing', board.gallery[1]] })).toThrow('placements');
    expect(() => validateBoard({ ...board, books: [board.books[0], board.books[0]] })).toThrow('Duplicate');
    expect(() => validateBoard({ ...board, tiers: [{ ...board.tiers[0], id }] })).toThrow('Duplicate');
    expect(() => validateBoard({ ...board, books: [board.books[0], { ...board.books[1], title: ' ONE ' }] })).toThrow('Duplicate');
    expect(() => validateBoard({ ...board, tiers: [{ ...board.tiers[0], color: 'bad' }] })).toThrow('tier');
  });

  it('surfaces read and write failures and supports explicit recovery', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied'); });
    expect(loadBoard()).toMatchObject({ blocked: true, warning: expect.stringContaining('Denied') });
    read.mockRestore();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    expect(() => saveBoard(createBoard())).toThrow('Quota exceeded');
    expect(() => resetSavedBoard()).toThrow('Quota exceeded');
    write.mockRestore();
    expect(resetSavedBoard()).toEqual(createBoard());
    expect(loadBoard().blocked).toBe(false);
  });
});
