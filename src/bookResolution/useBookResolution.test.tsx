import { useRef, useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createBoard, importBooks, moveBook, removeBook, type Board, type BoardChange } from '../board/board';
import { openLibraryClient } from '../integrations/openLibrary/client';
import type { WorkCandidate } from '../integrations/openLibrary/types';
import { useBookResolution } from './useBookResolution';

vi.mock('../integrations/openLibrary/client', () => ({
  openLibraryClient: { search: vi.fn(), searchPage: vi.fn(), editions: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(openLibraryClient.search).mockReset().mockResolvedValue([]);
  vi.mocked(openLibraryClient.searchPage).mockReset().mockImplementation(async (input, signal) => ({
    works: await openLibraryClient.search(input, signal), nextCursor: null,
  }));
});

function useBoardResolution(initial: Board) {
  const [board, setBoard] = useState(initial);
  const current = useRef(board);
  const change: BoardChange = (operation) => {
    current.current = operation(current.current);
    setBoard(current.current);
    return true;
  };
  return { board, change, ...useBookResolution(board, change) };
}

function savedBooks() {
  const board = importBooks(createBoard(), [
    { title: 'Dune', author: 'Frank Herbert' },
    { title: 'Hyperion', author: 'Dan Simmons' },
  ]);
  for (const book of board.books) {
    book.coverSelection = { kind: 'placeholder' };
    book.matchedWorkId = 'OL1W';
  }
  return moveBook(board, board.books[1].id, 'tier-S');
}

it('selects artwork only for the requested book without changing its placement', () => {
  const initial = savedBooks();
  const { result } = renderHook(() => useBoardResolution(initial));
  const selected = initial.books[1];
  const cover = { kind: 'local' as const, dataUrl: 'data:image/jpeg;base64,Y292ZXI=' };

  act(() => result.current.selectCover(selected, cover));

  expect(result.current.board.books[0]).toEqual(initial.books[0]);
  expect(result.current.board.books[1].coverSelection).toEqual(cover);
  expect(result.current.board.tiers).toEqual(initial.tiers);
  expect(result.current.board.gallery).toEqual(initial.gallery);
  expect(openLibraryClient.search).not.toHaveBeenCalled();
});

it('edits and retries a later book without resetting an earlier book', async () => {
  const initial = savedBooks();
  const { result } = renderHook(() => useBoardResolution(initial));
  const id = initial.books[1].id;

  act(() => {
    expect(result.current.saveBook(id, 'Hyperion Cantos', 'Dan Simmons', true)).toBeNull();
  });

  await waitFor(() => expect(result.current.states[id]?.outcome).toBe('not-found'));
  expect(result.current.board.books[0]).toEqual(initial.books[0]);
  expect(result.current.board.books[1]).toMatchObject({ title: 'Hyperion Cantos', author: 'Dan Simmons' });
  expect(result.current.board.books[1].matchedWorkId).toBeUndefined();
  expect(result.current.board.books[1].coverSelection).toBeUndefined();
  expect(result.current.board.tiers).toEqual(initial.tiers);
  expect(openLibraryClient.search).toHaveBeenCalledOnce();
  expect(openLibraryClient.search).toHaveBeenCalledWith(
    expect.objectContaining({ id, title: 'Hyperion Cantos' }), expect.any(AbortSignal),
  );
});

it('reports invalid edits without changing the board', () => {
  const initial = savedBooks();
  const { result } = renderHook(() => useBoardResolution(initial));

  act(() => {
    expect(result.current.saveBook(initial.books[1].id, ' ', 'Frank Herbert', false)).toContain('empty');
    expect(result.current.saveBook('missing', 'Dune', 'Frank Herbert', false)).toBe('Book not found.');
  });

  expect(result.current.board).toEqual(initial);
  expect(openLibraryClient.search).not.toHaveBeenCalled();
});

it('does not publish a chosen work when saving fails', () => {
  const initial = savedBooks();
  const change = vi.fn().mockReturnValue(false);
  const { result } = renderHook(() => useBookResolution(initial, change));
  act(() => {
    expect(result.current.selectWork(initial.books[0].id, {
      id: 'OL2W', title: 'Dune Messiah', authors: ['Frank Herbert'], covers: [],
      editions: [], nextCursor: null,
    })).toContain('Could not save');
  });
  expect(result.current.states).toEqual({});
  expect(initial.books[0].matchedWorkId).toBe('OL1W');
});

it('allows matching another book metadata without merging books or their artwork', () => {
  const initial = savedBooks();
  const { result } = renderHook(() => useBoardResolution(initial));
  act(() => {
    expect(result.current.saveBook(initial.books[1].id, 'Dune', 'Frank Herbert', false)).toBeNull();
  });
  expect(result.current.board.books).toHaveLength(2);
  expect(result.current.board.books[0]).toEqual(initial.books[0]);
  expect(result.current.board.books[1]).toMatchObject({
    id: initial.books[1].id, title: 'Dune', author: 'Frank Herbert', coverSelection: { kind: 'placeholder' },
  });
  expect(result.current.board.tiers).toEqual(initial.tiers);
  expect(result.current.board.gallery).toEqual(initial.gallery);
  expect(openLibraryClient.search).not.toHaveBeenCalled();
});

it('cancels lookup and ignores its late result after deleting a book', async () => {
  const initial = importBooks(createBoard(), [{ title: 'Dune', author: 'Frank Herbert' }]);
  let resolve!: (works: WorkCandidate[]) => void;
  vi.mocked(openLibraryClient.search).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { result } = renderHook(() => useBoardResolution(initial));
  const signal = vi.mocked(openLibraryClient.search).mock.calls[0][1];

  act(() => { result.current.change((board) => removeBook(board, initial.books[0].id)); });
  expect(signal.aborted).toBe(true);
  await act(async () => resolve([{
    id: 'OL1W', title: 'Dune', authors: ['Frank Herbert'], covers: [{ coverId: 123 }],
    editions: [], nextCursor: null,
  }]));

  expect(result.current.board.books).toHaveLength(0);
  expect(result.current.states).toEqual({});
});
