import { useRef, useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  createBoard,
  importBooks,
  moveBook,
  queueBook,
  removeBook,
  type Board,
  type BoardChange,
} from '../board/board';
import { openLibraryClient } from '../integrations/openLibrary/client';
import type { WorkCandidate } from '../integrations/openLibrary/types';
import { useBookResolution } from './useBookResolution';
import { extractBooks } from './extraction';

vi.mock('./extraction', () => ({ extractBooks: vi.fn() }));

vi.mock('../integrations/openLibrary/client', () => ({
  openLibraryClient: {
    search: vi.fn(),
    searchPage: vi.fn(),
    editions: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(extractBooks).mockReset();
  vi.mocked(openLibraryClient.search).mockReset().mockResolvedValue([]);
  vi.mocked(openLibraryClient.searchPage)
    .mockReset()
    .mockImplementation(async (input, signal) => ({
      works: await openLibraryClient.search(input, signal),
      nextCursor: null,
    }));
});

it.each([
  { title: 'Dune', author: 'Someone else' },
  { title: 'Dune Messiah', author: 'Frank Herbert' },
  { title: 'Dune', author: '' },
])('keeps multiple-match review without both exact fields: $title / $author', async (input) => {
  const works: WorkCandidate[] = [
    {
      id: 'OL1W',
      title: 'Dune',
      authors: ['Frank Herbert'],
      covers: [{ coverId: 123 }],
      editions: [],
      nextCursor: null,
    },
    {
      id: 'OL2W',
      title: 'Other book',
      authors: [],
      covers: [],
      editions: [],
      nextCursor: null,
    },
  ];
  vi.mocked(openLibraryClient.search).mockResolvedValueOnce(works);
  const initial = importBooks(createBoard(), [input]);
  const { result } = renderHook(() => useBoardResolution(initial));
  await waitFor(() =>
    expect(result.current.states[initial.books[0].id]).toMatchObject({
      outcome: 'needs-review',
      works,
    }),
  );
  expect(result.current.board).toEqual(initial);
});

it('persists an exact multi-author match without artwork and never reviews the other works', async () => {
  const exact: WorkCandidate = {
    id: 'OL2W',
    title: 'Good Omens',
    authors: ['Terry Pratchett', 'Neil Gaiman'],
    covers: [],
    editions: [],
    nextCursor: null,
  };
  vi.mocked(openLibraryClient.search).mockResolvedValueOnce([
    {
      ...exact,
      id: 'OL1W',
      authors: ['Terry Pratchett'],
      covers: [{ coverId: 123 }],
    },
    exact,
    { ...exact, id: 'OL3W', covers: [{ coverId: 456 }] },
  ]);
  const initial = importBooks(createBoard(), [{ title: 'good omens', author: 'terry pratchett, neil gaiman' }]);
  const id = initial.books[0].id;
  const { result } = renderHook(() => useBoardResolution(initial));
  await waitFor(() => expect(result.current.board.books[0].matchedWorkId).toBe('OL2W'));
  expect(result.current.board.books[0]).toMatchObject({
    title: 'Good Omens',
    author: 'Terry Pratchett, Neil Gaiman',
  });
  expect(result.current.board.books[0].coverSelection).toBeUndefined();
  expect(result.current.states[id]).toMatchObject({ works: [exact] });
});

it('uses AI matching for every extracted book, not manual multiple-match review', async () => {
  vi.mocked(extractBooks).mockResolvedValue([
    { title: 'Dune', author: 'Frank Herbert' },
    { title: 'Hyperion', author: 'Dan Simmons' },
  ]);
  vi.mocked(openLibraryClient.search).mockImplementation(async (book) => [
    {
      id: book.title === 'Dune' ? 'OL1W' : 'OL2W',
      title: book.title,
      authors: book.author ? [book.author] : [],
      covers: [{ coverId: 123 }],
      editions: [],
      nextCursor: null,
    },
    {
      id: 'OL3W',
      title: 'Other book',
      authors: [],
      covers: [],
      editions: [],
      nextCursor: null,
    },
  ]);
  const { result } = renderHook(() => useBoardResolution(queueBook(createBoard(), 'My library')));
  await waitFor(() => expect(result.current.board.books.every((book) => book.matchedWorkId)).toBe(true));
  expect(result.current.board.books).toHaveLength(2);
  expect(Object.values(result.current.states).map((state) => state.outcome)).toEqual(['matched', 'matched']);
  expect(extractBooks).toHaveBeenCalledOnce();
  expect(openLibraryClient.search).toHaveBeenCalledTimes(2);
});

it('imports an extracted batch atomically and queues AI matching without extracting it again', async () => {
  vi.mocked(openLibraryClient.search).mockImplementation(async (book) => [
    {
      id: book.title === 'Dune' ? 'OL1W' : 'OL2W',
      title: book.title,
      authors: ['Author'],
      covers: [{ coverId: 123 }],
      editions: [],
      nextCursor: null,
    },
    {
      id: 'OL3W',
      title: 'Other book',
      authors: [],
      covers: [],
      editions: [],
      nextCursor: null,
    },
  ]);
  const { result } = renderHook(() => useBoardResolution(createBoard()));
  act(() => {
    expect(
      result.current.addAiBooks([
        { title: 'Dune', author: '' },
        { title: 'Hyperion', author: '' },
      ]),
    ).toBe(true);
  });
  expect(result.current.board.books).toHaveLength(2);
  expect(result.current.board.books.every((book) => book.pendingInput === undefined)).toBe(true);
  await waitFor(() =>
    expect(Object.values(result.current.states).map((state) => state.outcome)).toEqual(['matched', 'matched']),
  );
  expect(extractBooks).not.toHaveBeenCalled();
});

it('does not queue or publish an extracted batch when adding it is rejected', () => {
  const initial = createBoard();
  const change = vi.fn().mockReturnValue(false);
  const { result } = renderHook(() => useBookResolution(initial, change));
  act(() => {
    expect(result.current.addAiBooks([{ title: 'Dune', author: '' }])).toBe(false);
  });
  expect(result.current.states).toEqual({});
  expect(initial.books).toHaveLength(0);
  expect(openLibraryClient.search).not.toHaveBeenCalled();
});

it('keeps a failed batch intact for retry and continues with the next submission', async () => {
  vi.mocked(extractBooks)
    .mockRejectedValueOnce(new Error('Invalid batch output'))
    .mockResolvedValueOnce([{ title: 'Later book', author: '' }])
    .mockResolvedValueOnce([
      { title: 'One', author: '' },
      { title: 'Two', author: '' },
    ]);
  const initial = queueBook(queueBook(createBoard(), 'Failed batch'), 'Later submission');
  const id = initial.books[0].id;
  const { result } = renderHook(() => useBoardResolution(initial));
  await waitFor(() => expect(result.current.board.books[1].title).toBe('Later book'));
  expect(result.current.states[id]).toMatchObject({
    outcome: 'error',
    error: 'Invalid batch output',
  });
  expect(result.current.board.books[0].pendingInput).toBe('Failed batch');
  act(() => result.current.retry(id));
  await waitFor(() => expect(result.current.board.books).toHaveLength(3));
  expect(result.current.board.books[0]).toMatchObject({ id, title: 'One' });
  expect(
    result.current.board.gallery.map((bookId) => result.current.board.books.find((book) => book.id === bookId)?.title),
  ).toEqual(['One', 'Two', 'Later book']);
  expect(extractBooks).toHaveBeenCalledTimes(3);
});

it('ignores an entire late batch after its pending card is removed', async () => {
  let finish!: (entries: { title: string; author: string }[]) => void;
  vi.mocked(extractBooks).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const initial = queueBook(createBoard(), 'Deleted library');
  const { result } = renderHook(() => useBoardResolution(initial));
  act(() => result.current.change((board) => removeBook(board, initial.books[0].id)));
  await act(async () =>
    finish([
      { title: 'One', author: '' },
      { title: 'Two', author: '' },
    ]),
  );
  expect(result.current.board.books).toHaveLength(0);
  expect(result.current.states).toEqual({});
  expect(openLibraryClient.search).not.toHaveBeenCalled();
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
  const cover = {
    kind: 'local' as const,
    dataUrl: 'data:image/jpeg;base64,Y292ZXI=',
  };

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
  expect(result.current.board.books[1]).toMatchObject({
    title: 'Hyperion Cantos',
    author: 'Dan Simmons',
  });
  expect(result.current.board.books[1].matchedWorkId).toBeUndefined();
  expect(result.current.board.books[1].coverSelection).toBeUndefined();
  expect(result.current.board.tiers).toEqual(initial.tiers);
  expect(openLibraryClient.search).toHaveBeenCalledOnce();
  expect(openLibraryClient.search).toHaveBeenCalledWith(
    expect.objectContaining({ id, title: 'Hyperion Cantos' }),
    expect.any(AbortSignal),
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
    expect(
      result.current.selectWork(initial.books[0].id, {
        id: 'OL2W',
        title: 'Dune Messiah',
        authors: ['Frank Herbert'],
        covers: [],
        editions: [],
        nextCursor: null,
      }),
    ).toContain('Could not save');
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
    id: initial.books[1].id,
    title: 'Dune',
    author: 'Frank Herbert',
    coverSelection: { kind: 'placeholder' },
  });
  expect(result.current.board.tiers).toEqual(initial.tiers);
  expect(result.current.board.gallery).toEqual(initial.gallery);
  expect(openLibraryClient.search).not.toHaveBeenCalled();
});

it('cancels lookup and ignores its late result after deleting a book', async () => {
  const initial = importBooks(createBoard(), [{ title: 'Dune', author: 'Frank Herbert' }]);
  let resolve!: (works: WorkCandidate[]) => void;
  vi.mocked(openLibraryClient.search).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { result } = renderHook(() => useBoardResolution(initial));
  const signal = vi.mocked(openLibraryClient.search).mock.calls[0][1];

  act(() => {
    result.current.change((board) => removeBook(board, initial.books[0].id));
  });
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve([
      {
        id: 'OL1W',
        title: 'Dune',
        authors: ['Frank Herbert'],
        covers: [{ coverId: 123 }],
        editions: [],
        nextCursor: null,
      },
    ]),
  );

  expect(result.current.board.books).toHaveLength(0);
  expect(result.current.states).toEqual({});
});
