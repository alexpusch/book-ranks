import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { STORAGE_KEY, validateBoard } from '../board/storage';
import { createBoard, importBooks, moveBook, type Board } from '../board/board';
import { coverUrl, type WorkCandidate } from '../integrations/openLibrary/types';
import { openLibraryClient } from '../integrations/openLibrary/client';
import * as localCover from '../books/localCover';
import placeholder from '../books/assets/cover.svg';

vi.mock('../integrations/openLibrary/client', () => ({
  openLibraryClient: {
    search: vi.fn(),
    searchPage: vi.fn(),
    editions: vi.fn(),
  },
}));
const search = vi.mocked(openLibraryClient.search);
const editions = vi.mocked(openLibraryClient.editions);
const selection = {
  kind: 'open-library' as const,
  workId: 'OL1W',
  coverId: 123,
  editionId: 'OL1M',
};
const work: WorkCandidate = {
  id: 'OL1W',
  title: 'Dune',
  authors: ['Frank Herbert'],
  covers: [{ coverId: 123 }],
  editions: [],
  nextCursor: '0',
};
const edition = {
  id: 'OL1M',
  title: 'Dune',
  covers: [{ coverId: 456, editionId: 'OL1M' }],
  languages: ['eng'],
  publishers: ['Publisher'],
  isbns: [],
  publicationDate: '2025',
};
beforeEach(() => {
  window.history.replaceState(null, '', '/?ai=true');
  localStorage.clear();
  search.mockReset().mockResolvedValue([]);
  vi.mocked(openLibraryClient.searchPage)
    .mockReset()
    .mockImplementation(async (input, signal) => ({
      works: await search(input, signal),
      nextCursor: null,
    }));
  editions.mockReset().mockResolvedValue({ editions: [edition], nextCursor: null });
});
function persist(board: Board) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  return board;
}
function seed(coverSelection?: typeof selection | { kind: 'placeholder' }) {
  let board = importBooks(createBoard(), 'Dune | Frank Herbert');
  if (coverSelection) board.books[0].coverSelection = coverSelection;
  board = moveBook(board, board.books[0].id, 'tier-S');
  return persist(board);
}
function saved(): Board {
  return validateBoard(JSON.parse(localStorage.getItem(STORAGE_KEY)!));
}
async function edit() {
  await userEvent.click(screen.getByRole('button', { name: 'Edit Dune' }));
  return screen.getByRole('dialog');
}

const otherWork: WorkCandidate = {
  id: 'OL2W',
  title: 'Dune Messiah',
  authors: ['Frank Herbert'],
  covers: [{ coverId: 789 }],
  editions: [],
  nextCursor: '0',
};
const ambiguousWork = { ...work, authors: ['F. Herbert'] };

it.each(['Manual entry', 'Bulk insert'])('automatically selects an exact title and author in %s', async (mode) => {
  window.history.replaceState(null, '', '/');
  search.mockResolvedValueOnce([otherWork, work]);
  const rendered = render(<App />);
  await userEvent.click(screen.getByRole('button', { name: mode }));
  if (mode === 'Bulk insert') {
    await userEvent.type(screen.getByLabelText('Books to add'), 'dUnE | fRaNk HeRbErT');
  } else {
    await userEvent.type(screen.getByLabelText('Book name'), 'dUnE');
    await userEvent.type(screen.getByLabelText(/Author/), 'fRaNk HeRbErT');
  }
  await userEvent.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
  await waitFor(() =>
    expect(saved().books[0]).toMatchObject({
      title: 'Dune',
      author: 'Frank Herbert',
      matchedWorkId: 'OL1W',
      coverSelection: { kind: 'open-library', workId: 'OL1W', coverId: 123 },
    }),
  );
  expect(screen.queryByText('Multiple matches')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Drag Dune' })).toBeInTheDocument();
  expect(editions).not.toHaveBeenCalled();
  expect(window.LanguageModel!.create).not.toHaveBeenCalled();
  rendered.unmount();
  search.mockClear();
  render(<App />);
  expect(screen.getByRole('button', { name: 'Edit Dune' })).toBeInTheDocument();
  expect(search).not.toHaveBeenCalled();
});

it('appends more matches, deduplicates work IDs, and pages the submitted query rather than edited drafts', async () => {
  seed();
  const thirdWork = { ...work, id: 'OL3W', title: 'Children of Dune' };
  const page = vi.mocked(openLibraryClient.searchPage);
  page
    .mockResolvedValueOnce({
      works: [ambiguousWork, otherWork],
      nextCursor: '10',
    })
    .mockResolvedValueOnce({
      works: [otherWork, thirdWork, thirdWork],
      nextCursor: '20',
    })
    .mockResolvedValueOnce({ works: [], nextCursor: null });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review Dune' }));
  const dialog = screen.getByRole('dialog');
  const gallery = within(dialog).getByRole('group', {
    name: 'Book match gallery',
  });
  expect(page).toHaveBeenCalledOnce();
  await userEvent.type(within(dialog).getByLabelText('Book title'), ' draft');
  await userEvent.clear(within(dialog).getByLabelText('Author'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Show more' }));
  expect(page).toHaveBeenLastCalledWith(
    {
      title: 'Dune',
      author: 'Frank Herbert',
      cursor: '10',
    },
    expect.any(AbortSignal),
  );
  expect(
    await within(gallery).findByRole('button', {
      name: 'Select Children of Dune by Frank Herbert',
    }),
  ).toBeInTheDocument();
  expect(within(gallery).getAllByRole('button')).toHaveLength(3);
  expect(gallery.querySelector(`img[src="${coverUrl(789)}"]`)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Show more' }));
  expect(page).toHaveBeenLastCalledWith(
    {
      title: 'Dune',
      author: 'Frank Herbert',
      cursor: '20',
    },
    expect.any(AbortSignal),
  );
  expect(await within(dialog).findByText('All matching works loaded.')).toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  expect(within(gallery).getAllByRole('button')).toHaveLength(3);
  await userEvent.click(
    within(gallery).getByRole('button', {
      name: 'Select Children of Dune by Frank Herbert',
    }),
  );
  expect(saved().books[0]).toMatchObject({
    title: 'Children of Dune',
    matchedWorkId: 'OL3W',
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps earlier matches on a pagination failure and retries the same page', async () => {
  const board = seed();
  const page = vi.mocked(openLibraryClient.searchPage);
  page
    .mockResolvedValueOnce({
      works: [ambiguousWork, otherWork],
      nextCursor: '10',
    })
    .mockRejectedValueOnce(new Error('More results offline'))
    .mockResolvedValueOnce({
      works: [{ ...work, id: 'OL3W', title: 'Children of Dune' }],
      nextCursor: null,
    });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review Dune' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Show more' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('More results offline');
  expect(within(dialog).getByRole('button', { name: 'Select Dune by F. Herbert' })).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Show more' }));
  expect(
    await within(dialog).findByRole('button', {
      name: 'Select Children of Dune by Frank Herbert',
    }),
  ).toBeInTheDocument();
  expect(page.mock.calls[1][0].cursor).toBe('10');
  expect(page.mock.calls[2][0].cursor).toBe('10');
  expect(saved().books[0]).toEqual(board.books[0]);
});

it('refining a search cancels pagination, resets its cursor, and ignores its late page', async () => {
  seed();
  let finish!: (works: { works: WorkCandidate[]; nextCursor: string | null }) => void;
  const page = vi.mocked(openLibraryClient.searchPage);
  page
    .mockResolvedValueOnce({
      works: [ambiguousWork, otherWork],
      nextCursor: '10',
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ works: [otherWork], nextCursor: '10' });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review Dune' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Show more' }));
  expect(within(dialog).getByRole('button', { name: 'Loading more...' })).toBeDisabled();
  expect(page).toHaveBeenCalledTimes(2);
  await userEvent.clear(within(dialog).getByLabelText('Book title'));
  await userEvent.type(within(dialog).getByLabelText('Book title'), 'Dune Messiah');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Search' }));
  expect(page.mock.calls[1][1].aborted).toBe(true);
  expect(page).toHaveBeenLastCalledWith({ title: 'Dune Messiah', author: 'Frank Herbert' }, expect.any(AbortSignal));
  await act(async () => finish({ works: [work], nextCursor: '20' }));
  expect(
    within(dialog).queryByRole('button', {
      name: 'Select Dune by Frank Herbert',
    }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).getByRole('button', {
      name: 'Select Dune Messiah by Frank Herbert',
    }),
  ).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Show more' }));
  expect(page).toHaveBeenLastCalledWith(
    {
      title: 'Dune Messiah',
      author: 'Frank Herbert',
      cursor: '10',
    },
    expect.any(AbortSignal),
  );
});

it.each(['available', 'unavailable'] as const)(
  'reviews multiple manual matches with Chrome AI %s, then persists the selected book',
  async (availability) => {
    vi.mocked(window.LanguageModel!.availability).mockResolvedValue(availability);
    const board = seed();
    search.mockResolvedValueOnce([ambiguousWork, otherWork]);
    const rendered = render(<App />);
    const label = await screen.findByText('Multiple matches');
    const card = label.closest('article')!;
    expect(within(card).getAllByRole('button')).toHaveLength(2);
    expect(within(card).queryByRole('button', { name: 'Drag Dune' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Edit Dune' })).not.toBeInTheDocument();
    expect(saved().books[0]).toEqual(board.books[0]);
    expect(editions).not.toHaveBeenCalled();
    expect(window.LanguageModel!.create).not.toHaveBeenCalled();
    await userEvent.click(within(card).getByRole('button', { name: 'Review Dune' }));
    const dialog = screen.getByRole('dialog', { name: 'Review book matches' });
    expect(within(dialog).getByLabelText('Book title')).toHaveValue('Dune');
    expect(within(dialog).getByLabelText('Author')).toHaveValue('Frank Herbert');
    const gallery = within(dialog).getByRole('group', {
      name: 'Book match gallery',
    });
    expect(gallery.querySelector(`img[src="${coverUrl(123)}"]`)).toBeInTheDocument();
    expect(gallery.querySelector(`img[src="${coverUrl(789)}"]`)).toBeInTheDocument();
    await userEvent.click(
      within(gallery).getByRole('button', {
        name: 'Select Dune Messiah by Frank Herbert',
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Multiple matches')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag Dune Messiah' })).toBeInTheDocument();
    expect(saved().books[0]).toMatchObject({
      id: board.books[0].id,
      title: 'Dune Messiah',
      author: 'Frank Herbert',
      matchedWorkId: 'OL2W',
      coverSelection: { kind: 'open-library', workId: 'OL2W', coverId: 789 },
    });
    expect(saved().tiers).toEqual(board.tiers);
    expect(saved().gallery).toEqual(board.gallery);
    rendered.unmount();
    search.mockClear();
    render(<App />);
    expect(screen.getByRole('button', { name: 'Edit Dune Messiah' })).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  },
);

it('refines review searches without changing the book until choosing a result, including results without covers', async () => {
  const board = seed();
  search.mockResolvedValueOnce([ambiguousWork, otherWork]).mockResolvedValueOnce([{ ...otherWork, covers: [] }]);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review Dune' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.clear(within(dialog).getByLabelText('Book title'));
  await userEvent.type(within(dialog).getByLabelText('Book title'), 'Dune Messiah');
  await userEvent.clear(within(dialog).getByLabelText('Author'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Search' }));
  expect(search).toHaveBeenLastCalledWith({ title: 'Dune Messiah', author: undefined }, expect.any(AbortSignal));
  const option = await within(dialog).findByRole('button', {
    name: 'Select Dune Messiah by Frank Herbert',
  });
  expect(
    within(dialog).queryByRole('button', {
      name: 'Select Dune by Frank Herbert',
    }),
  ).not.toBeInTheDocument();
  expect(saved().books[0]).toEqual(board.books[0]);
  await userEvent.click(option);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(saved().books[0].matchedWorkId).toBe('OL2W');
  expect(saved().books[0].coverSelection).toBeUndefined();
  expect(editions).not.toHaveBeenCalled();
});

it('shows empty results and search errors in review and allows retry', async () => {
  const board = seed();
  search
    .mockResolvedValueOnce([ambiguousWork, otherWork])
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error('Open Library offline'))
    .mockResolvedValueOnce([work]);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review Dune' }));
  const dialog = screen.getByRole('dialog');
  const button = within(dialog).getByRole('button', { name: 'Search' });
  await userEvent.click(button);
  expect(await within(dialog).findByRole('status')).toHaveTextContent('No matching works found');
  await userEvent.click(button);
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Open Library offline');
  await userEvent.click(button);
  expect(
    await within(dialog).findByRole('button', {
      name: 'Select Dune by Frank Herbert',
    }),
  ).toBeInTheDocument();
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  expect(saved().books[0]).toEqual(board.books[0]);
});

it('cancels replaced review searches and closing the reviewer ignores late results', async () => {
  const board = seed();
  let finishFirst!: (works: WorkCandidate[]) => void;
  let finishSecond!: (works: WorkCandidate[]) => void;
  search
    .mockResolvedValueOnce([ambiguousWork, otherWork])
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = resolve;
        }),
    );
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review Dune' }));
  const button = screen.getByRole('button', { name: 'Search' });
  await userEvent.click(button);
  const firstSignal = search.mock.calls[1][1];
  await userEvent.click(button);
  expect(firstSignal.aborted).toBe(true);
  await act(async () => finishFirst([work]));
  expect(screen.queryByRole('button', { name: 'Select Dune by Frank Herbert' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('Searching Open Library');
  const secondSignal = search.mock.calls[2][1];
  await userEvent.click(screen.getByRole('button', { name: 'Close book review' }));
  expect(secondSignal.aborted).toBe(true);
  await act(async () => finishSecond([otherWork]));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(saved().books[0]).toEqual(board.books[0]);
});

it('removes unresolved multiple-match books from the gallery', async () => {
  const board = importBooks(createBoard(), 'Dune | Frank Herbert');
  persist(board);
  search.mockResolvedValueOnce([ambiguousWork, otherWork]);
  render(<App />);
  await screen.findByText('Multiple matches');
  await userEvent.click(screen.getByRole('button', { name: 'Remove Dune' }));
  expect(saved().books).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Review Dune' })).not.toBeInTheDocument();
});

it('opens the upload picker and applies local artwork without changing metadata or placements', async () => {
  const board = seed();
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const cover = {
    kind: 'local' as const,
    dataUrl: 'data:image/jpeg;base64,Y292ZXI=',
  };
  const read = vi.spyOn(localCover, 'readLocalCover').mockResolvedValue(cover);
  const rendered = render(<App />);
  const dialog = await edit();
  const input = within(dialog).getByLabelText('Cover photo');
  const click = vi.spyOn(input, 'click');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Upload photo' }));
  expect(click).toHaveBeenCalledOnce();
  fireEvent.change(input, {
    target: { files: [new File(['png'], 'cover.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => resolve([work]));
  expect(saved().books[0]).toMatchObject({
    title: 'Dune',
    author: 'Frank Herbert',
    coverSelection: cover,
  });
  expect(saved().tiers).toEqual(board.tiers);
  rendered.unmount();
  search.mockClear();
  render(<App />);
  await edit();
  expect(screen.getByRole('button', { name: 'Select your uploaded cover' })).toHaveAttribute('aria-pressed', 'true');
  expect(search).not.toHaveBeenCalled();
  read.mockRestore();
});

it('reads and saves a clipboard image on click without opening a paste form or requiring keyboard paste', async () => {
  const user = userEvent.setup();
  const file = new File(['png'], 'pasted.png', { type: 'image/png' });
  const getType = vi.fn().mockResolvedValue(file);
  const clipboardRead = vi.spyOn(navigator.clipboard, 'read').mockResolvedValue([
    { types: ['text/plain'], presentationStyle: 'unspecified', getType: vi.fn() },
    { types: ['text/html', 'image/png'], presentationStyle: 'unspecified', getType },
  ]);
  const cover = { kind: 'local' as const, dataUrl: 'data:image/jpeg;base64,Y292ZXI=' };
  const read = vi.spyOn(localCover, 'readLocalCover').mockResolvedValue(cover);
  const board = seed(selection);
  const rendered = render(<App />);
  const dialog = await edit();
  fireEvent.paste(dialog, { clipboardData: { files: [file] } });
  expect(read).not.toHaveBeenCalled();
  expect(clipboardRead).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Paste image' }));
  expect(clipboardRead).toHaveBeenCalledOnce();
  expect(getType).toHaveBeenCalledWith('image/png');
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }), expect.any(AbortSignal));
  expect(screen.queryByRole('group', { name: 'Paste cover image' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel paste' })).not.toBeInTheDocument();
  await waitFor(() => expect(saved().books[0].coverSelection).toEqual(cover));
  expect(saved().tiers).toEqual(board.tiers);
  rendered.unmount();
  render(<App />);
  expect(saved().books[0].coverSelection).toEqual(cover);
  read.mockRestore();
});

it.each([
  ['empty', 'No image found'],
  ['text', 'No image found'],
  ['denied', 'Allow clipboard access'],
  ['invalid', 'Could not decode image'],
])('reports %s clipboard content without replacing the cover and allows retry', async (failure, message) => {
  const user = userEvent.setup();
  const file = new File(['png'], 'pasted.png', { type: 'image/png' });
  const item: ClipboardItem = {
    types: ['image/png'],
    presentationStyle: 'unspecified',
    getType: vi.fn().mockResolvedValue(file),
  };
  const clipboardRead = vi.spyOn(navigator.clipboard, 'read');
  if (failure === 'denied') clipboardRead.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
  else if (failure === 'text') clipboardRead.mockResolvedValueOnce([{ ...item, types: ['text/plain'] }]);
  else clipboardRead.mockResolvedValueOnce(failure === 'empty' ? [] : [item]);
  clipboardRead.mockResolvedValue([item]);
  const cover = { kind: 'local' as const, dataUrl: 'data:image/jpeg;base64,Y292ZXI=' };
  const read = vi.spyOn(localCover, 'readLocalCover').mockResolvedValue(cover);
  if (failure === 'invalid') read.mockRejectedValueOnce(new Error('Could not decode image'));
  seed(selection);
  render(<App />);
  const dialog = await edit();
  await user.click(within(dialog).getByRole('button', { name: 'Paste image' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(saved().books[0].coverSelection).toEqual(selection);
  expect(within(dialog).getByRole('button', { name: 'Upload photo' })).toBeEnabled();
  await user.click(within(dialog).getByRole('button', { name: 'Paste image' }));
  await waitFor(() => expect(saved().books[0].coverSelection).toEqual(cover));
  read.mockRestore();
});

it('offers upload when clipboard image reading is unsupported', async () => {
  const user = userEvent.setup();
  const clipboardRead = vi.spyOn(navigator.clipboard, 'read');
  Object.defineProperty(navigator.clipboard, 'read', { configurable: true, value: undefined });
  seed(selection);
  render(<App />);
  const dialog = await edit();
  await user.click(within(dialog).getByRole('button', { name: 'Paste image' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not supported in this browser. Upload a photo instead.');
  expect(within(dialog).getByRole('button', { name: 'Upload photo' })).toBeEnabled();
  expect(saved().books[0].coverSelection).toEqual(selection);
  clipboardRead.mockRestore();
});

it('disables image actions during clipboard reading and ignores the result after closing the editor', async () => {
  const user = userEvent.setup();
  let finish!: (items: ClipboardItem[]) => void;
  const clipboardRead = vi.spyOn(navigator.clipboard, 'read').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const read = vi.spyOn(localCover, 'readLocalCover');
  seed(selection);
  render(<App />);
  const dialog = await edit();
  const paste = within(dialog).getByRole('button', { name: 'Paste image' });
  await user.click(paste);
  expect(paste).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Upload photo' })).toBeDisabled();
  await user.click(paste);
  expect(clipboardRead).toHaveBeenCalledOnce();
  await user.click(within(dialog).getByRole('button', { name: 'Close book editor' }));
  await act(async () =>
    finish([
      {
        types: ['image/png'],
        presentationStyle: 'unspecified',
        getType: async () => new Blob(['png'], { type: 'image/png' }),
      },
    ]),
  );
  expect(read).not.toHaveBeenCalled();
  expect(saved().books[0].coverSelection).toEqual(selection);
  read.mockRestore();
});

it('reports invalid uploads without replacing the saved cover and allows selecting the same file again', async () => {
  seed(selection);
  render(<App />);
  const dialog = await edit();
  const input = within(dialog).getByLabelText('Cover photo');
  const file = new File(['text'], 'cover.txt', { type: 'text/plain' });
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a JPEG');
  expect(saved().books[0].coverSelection).toEqual(selection);
  expect(input).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Upload photo' })).toBeEnabled();
});

it.each([
  ['MacIntel', 'cmd+v to paste cover image'],
  ['MacPPC', 'cmd+v to paste cover image'],
  ['Win32', 'ctrl+v to paste cover image'],
  ['Linux x86_64', 'ctrl+v to paste cover image'],
])('shows the OS-specific paste hint on %s', (platform, hint) => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  seed(selection);
  const rendered = render(<App />);
  const card = rendered.container.querySelector<HTMLElement>('[data-book-id]')!;
  expect(card).toHaveAttribute('title', hint);
  expect(within(card).queryByRole('img', { name: hint })).not.toBeInTheDocument();
});

it.each(['gallery', 'tier-S'])(
  'pastes a cover directly onto the hovered card in %s and persists it',
  async (location) => {
    let board = importBooks(createBoard(), 'Dune | Frank Herbert\nDune | Frank Herbert');
    board.books.forEach((book) => {
      book.coverSelection = selection;
    });
    board = moveBook(board, board.books[0].id, location);
    persist(board);
    const cover = {
      kind: 'local' as const,
      dataUrl: 'data:image/jpeg;base64,Y292ZXI=',
    };
    const read = vi.spyOn(localCover, 'readLocalCover').mockResolvedValue(cover);
    const rendered = render(<App />);
    const card = rendered.container.querySelector<HTMLElement>(`[data-book-id="${board.books[0].id}"]`)!;
    fireEvent.pointerEnter(card, { pointerType: 'mouse' });
    const file = new File(['png'], 'pasted.png', { type: 'image/png' });
    expect(fireEvent.paste(document.body, { clipboardData: { files: [file] } })).toBe(false);
    await waitFor(() => expect(saved().books[0].coverSelection).toEqual(cover));
    expect(read).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    expect(saved().books[0]).toEqual({
      ...board.books[0],
      coverSelection: cover,
    });
    expect(saved().books[1]).toEqual(board.books[1]);
    expect(saved().gallery).toEqual(board.gallery);
    expect(saved().tiers).toEqual(board.tiers);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rendered.unmount();
    const restored = render(<App />);
    expect(restored.container.querySelector(`[data-book-id="${board.books[0].id}"] img`)).toHaveAttribute(
      'src',
      cover.dataUrl,
    );
  },
);

it('leaves ordinary paste alone outside hovered cards, in editable fields, and in dialogs', async () => {
  seed(selection);
  const rendered = render(<App />);
  const card = rendered.container.querySelector<HTMLElement>('[data-book-id]')!;
  const read = vi.spyOn(localCover, 'readLocalCover');
  const image = {
    clipboardData: {
      files: [new File(['png'], 'pasted.png', { type: 'image/png' })],
    },
  };
  expect(fireEvent.paste(document.body, image)).toBe(true);
  fireEvent.pointerEnter(card);
  expect(fireEvent.paste(document.body, { clipboardData: { files: [] } })).toBe(true);
  const input = screen.getByLabelText('Book name');
  input.focus();
  expect(fireEvent.paste(input, image)).toBe(true);
  expect(fireEvent.paste(document.body, image)).toBe(true);
  input.blur();
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  document.body.append(editable);
  expect(fireEvent.paste(editable, image)).toBe(true);
  editable.remove();
  card.classList.add('is-dragging');
  expect(fireEvent.paste(document.body, image)).toBe(true);
  card.classList.remove('is-dragging');
  fireEvent.pointerLeave(card);
  expect(fireEvent.paste(document.body, image)).toBe(true);
  fireEvent.pointerEnter(card);
  const dialog = await edit();
  expect(fireEvent.paste(dialog, image)).toBe(true);
  expect(read).not.toHaveBeenCalled();
  expect(saved().books[0].coverSelection).toEqual(selection);
});

it('reports hovered-cover failures, blocks repeated pastes while preparing, and allows retry', async () => {
  seed(selection);
  const read = vi
    .spyOn(localCover, 'readLocalCover')
    .mockRejectedValueOnce(new Error('This image could not be opened.'));
  const rendered = render(<App />);
  const card = rendered.container.querySelector<HTMLElement>('[data-book-id]')!;
  fireEvent.pointerEnter(card);
  const image = {
    clipboardData: {
      files: [new File(['png'], 'pasted.png', { type: 'image/png' })],
    },
  };
  fireEvent.paste(document.body, image);
  expect(await screen.findByRole('alert')).toHaveTextContent('This image could not be opened.');
  expect(saved().books[0].coverSelection).toEqual(selection);
  let resolve!: (selection: Awaited<ReturnType<typeof localCover.readLocalCover>>) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.paste(document.body, image);
  fireEvent.paste(document.body, image);
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Preparing cover image...')).toBeInTheDocument();
  await act(async () => resolve({ kind: 'local', dataUrl: 'data:image/jpeg;base64,Y292ZXI=' }));
  expect(saved().books[0].coverSelection?.kind).toBe('local');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('does not apply a pending pasted cover to a deleted book or a later hovered book', async () => {
  const board = importBooks(createBoard(), 'Dune | Frank Herbert\nDune Messiah | Frank Herbert');
  board.books.forEach((book) => {
    book.coverSelection = selection;
  });
  persist(board);
  let resolve!: (selection: Awaited<ReturnType<typeof localCover.readLocalCover>>) => void;
  vi.spyOn(localCover, 'readLocalCover').mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const rendered = render(<App />);
  const cards = rendered.container.querySelectorAll<HTMLElement>('[data-book-id]');
  fireEvent.pointerEnter(cards[0]);
  fireEvent.paste(document.body, {
    clipboardData: {
      files: [new File(['png'], 'cover.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Remove Dune$/ }));
  fireEvent.pointerEnter(cards[1]);
  await act(async () => resolve({ kind: 'local', dataUrl: 'data:image/jpeg;base64,Y292ZXI=' }));
  expect(saved().books).toEqual([board.books[1]]);
});

it('preserves pasted artwork when an in-flight lookup finishes', async () => {
  seed();
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const cover = {
    kind: 'local' as const,
    dataUrl: 'data:image/jpeg;base64,Y292ZXI=',
  };
  vi.spyOn(localCover, 'readLocalCover').mockResolvedValue(cover);
  const rendered = render(<App />);
  fireEvent.pointerEnter(rendered.container.querySelector('[data-book-id]')!);
  fireEvent.paste(document.body, {
    clipboardData: {
      files: [new File(['png'], 'cover.png', { type: 'image/png' })],
    },
  });
  await waitFor(() => expect(saved().books[0].coverSelection).toEqual(cover));
  await act(async () => resolve([work]));
  expect(saved().books[0].coverSelection).toEqual(cover);
});

it('aborts image preparation and removes the shortcut listener on unmount', async () => {
  seed(selection);
  let resolve!: (selection: Awaited<ReturnType<typeof localCover.readLocalCover>>) => void;
  const read = vi.spyOn(localCover, 'readLocalCover').mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const rendered = render(<App />);
  fireEvent.pointerEnter(rendered.container.querySelector('[data-book-id]')!);
  const image = {
    clipboardData: {
      files: [new File(['png'], 'cover.png', { type: 'image/png' })],
    },
  };
  fireEvent.paste(document.body, image);
  const signal = read.mock.calls[0][1];
  rendered.unmount();
  expect(signal.aborted).toBe(true);
  expect(fireEvent.paste(document.body, image)).toBe(true);
  await act(async () => resolve({ kind: 'local', dataUrl: 'data:image/jpeg;base64,Y292ZXI=' }));
  expect(saved().books[0].coverSelection).toEqual(selection);
});

it('preserves version 1 selections and validates matched work identifiers, not URLs', () => {
  const board = seed(selection);
  board.books[0].matchedWorkId = 'OL1W';
  expect(validateBoard(board)).toEqual(board);
  for (const invalid of [
    { ...selection, coverId: -1 },
    { ...selection, workId: 'https://evil.invalid' },
    { ...selection, editionId: 'OL1W' },
    { ...selection, url: 'https://evil.invalid' },
  ]) {
    expect(() =>
      validateBoard({
        ...board,
        books: [{ ...board.books[0], coverSelection: invalid }],
      }),
    ).toThrow('cover selection');
  }
  expect(() =>
    validateBoard({
      ...board,
      books: [{ ...board.books[0], matchedWorkId: 'https://evil.invalid' }],
    }),
  ).toThrow('matched work');
});

it('renders persisted artwork without metadata lookup, including when the editor opens', async () => {
  seed(selection);
  const { container } = render(<App />);
  expect(container.querySelectorAll(`img[src="${coverUrl(123)}"]`)).toHaveLength(2);
  fireEvent.error(container.querySelector('img')!);
  await userEvent.click(screen.getByRole('button', { name: 'Retry image' }));
  expect(screen.queryByText(/Artwork unavailable/)).not.toBeInTheDocument();
  const dialog = await edit();
  expect(within(dialog).getByRole('group', { name: 'Cover gallery' }).lastElementChild).toHaveTextContent(
    'Your own cover',
  );
  expect(within(dialog).getByRole('button', { name: /Select edition OL1M/ })).toHaveAttribute('aria-pressed', 'true');
  expect(search).not.toHaveBeenCalled();
  expect(editions).not.toHaveBeenCalled();
});

it('applies only search-result metadata and representative artwork without fetching editions or looping', async () => {
  const board = seed();
  search.mockResolvedValueOnce([
    {
      ...work,
      title: 'Dune: The Novel',
      authors: ['Frank Herbert', 'Other Author'],
    },
  ]);
  render(<App />);
  await waitFor(() =>
    expect(saved().books[0]).toMatchObject({
      title: 'Dune: The Novel',
      author: 'Frank Herbert, Other Author',
      matchedWorkId: 'OL1W',
      coverSelection: { kind: 'open-library', workId: 'OL1W', coverId: 123 },
    }),
  );
  expect(saved().tiers).toEqual(board.tiers);
  expect(search).toHaveBeenCalledOnce();
  expect(editions).not.toHaveBeenCalled();
});

it('persists a matched identity without a cover and does not repeat lookup on reload', async () => {
  seed();
  search.mockResolvedValueOnce([{ ...work, covers: [] }]);
  const rendered = render(<App />);
  await waitFor(() => expect(saved().books[0].matchedWorkId).toBe('OL1W'));
  expect(saved().books[0].coverSelection).toBeUndefined();
  rendered.unmount();
  search.mockClear();
  render(<App />);
  await edit();
  expect(search).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Find additional editions and covers' })).toBeEnabled();
});

it('shows a placeholder without a review label when Chrome AI returns no suitable match', async () => {
  seed();
  search.mockResolvedValueOnce([ambiguousWork]);
  vi.mocked(window.LanguageModel!.create).mockResolvedValueOnce({
    prompt: vi.fn().mockResolvedValue('{"workId":null}'),
    destroy: vi.fn(),
  });
  render(<App />);
  await edit();
  expect(await screen.findByText('Review the works and editions before choosing artwork.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Close book editor' }));
  const card = screen.getByRole('article', { name: 'Dune by Frank Herbert' });
  expect(card.querySelector('img.book-cover')).toHaveAttribute('src', placeholder);
  expect(within(card).queryByText('Review required')).not.toBeInTheDocument();
  expect(saved().books[0].matchedWorkId).toBeUndefined();
});

it('shows a placeholder without a review label when a matched work has no artwork', async () => {
  seed();
  search.mockResolvedValueOnce([{ ...work, covers: [] }]);
  render(<App />);
  await waitFor(() => expect(saved().books[0].matchedWorkId).toBe('OL1W'));
  const card = screen.getByRole('article', { name: 'Dune by Frank Herbert' });
  expect(card.querySelector('img.book-cover')).toHaveAttribute('src', placeholder);
  expect(within(card).queryByText('Review required')).not.toBeInTheDocument();
  expect(saved().books[0].coverSelection).toBeUndefined();
  expect(screen.getByRole('button', { name: 'Drag Dune' })).toBeInTheDocument();
});

it('applies duplicate canonical metadata without merging placements or corrupting saved data', async () => {
  const board = importBooks(seed(), 'Dune: Canonical | Frank Herbert');
  board.books[1].coverSelection = { kind: 'placeholder' };
  persist(board);
  search.mockResolvedValueOnce([{ ...work, title: 'Dune: Canonical' }]);
  render(<App />);
  await waitFor(() => expect(saved().books[0].matchedWorkId).toBe('OL1W'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(saved().books).toHaveLength(2);
  expect(saved().books[0].title).toBe('Dune: Canonical');
  expect(saved().books[1]).toEqual(board.books[1]);
  expect(saved().gallery).toEqual(board.gallery);
  expect(saved().tiers).toEqual(board.tiers);
});

it('loads editions only on an explicit click and subsequent pages only on another click', async () => {
  seed(selection);
  editions.mockResolvedValueOnce({ editions: [edition], nextCursor: '20' }).mockResolvedValueOnce({
    editions: [{ ...edition, id: 'OL2M', covers: [{ coverId: 789 }] }],
    nextCursor: null,
  });
  render(<App />);
  const dialog = await edit();
  expect(editions).not.toHaveBeenCalled();
  await userEvent.click(
    within(dialog).getByRole('button', {
      name: 'Find additional editions and covers',
    }),
  );
  const tile = await screen.findByRole('button', {
    name: /Select edition OL1M.*2025/,
  });
  expect(tile.parentElement).toHaveTextContent('2025');
  expect(editions).toHaveBeenCalledExactlyOnceWith({ workId: 'OL1W', cursor: '0' }, expect.any(AbortSignal));
  await userEvent.click(screen.getByRole('button', { name: 'More editions and covers' }));
  expect(await screen.findByText('All available editions loaded.')).toBeInTheDocument();
  expect(editions).toHaveBeenLastCalledWith({ workId: 'OL1W', cursor: '20' }, expect.any(AbortSignal));
  await userEvent.click(tile);
  expect(saved().books[0].coverSelection).toEqual({
    ...selection,
    coverId: 456,
  });
  expect(saved().books[0]).toMatchObject({
    title: 'Dune',
    author: 'Frank Herbert',
  });
});

it('deduplicates edition artwork while retaining a saved association and its release date', async () => {
  seed(selection);
  editions.mockResolvedValueOnce({
    editions: [
      { ...edition, covers: [{ coverId: 123 }] },
      { ...edition, id: 'OL2M', covers: [{ coverId: 123 }] },
    ],
    nextCursor: null,
  });
  render(<App />);
  const dialog = await edit();
  await userEvent.click(
    within(dialog).getByRole('button', {
      name: 'Find additional editions and covers',
    }),
  );
  const tile = await screen.findByRole('button', {
    name: /Select edition OL1M.*2025/,
  });
  expect(tile).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('group', { name: 'Cover gallery' }).querySelectorAll('img')).toHaveLength(2);
});

it('reports edition errors and retries the same page without discarding the selection', async () => {
  seed(selection);
  editions.mockRejectedValueOnce(new Error('Edition request offline'));
  render(<App />);
  await edit();
  await userEvent.click(screen.getByRole('button', { name: 'Find additional editions and covers' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Edition request offline');
  await userEvent.click(screen.getByRole('button', { name: 'Retry edition search' }));
  expect(await screen.findByText('All available editions loaded.')).toBeInTheDocument();
  expect(saved().books[0].coverSelection).toEqual(selection);
});

it('cancels an edition request when the editor closes', async () => {
  seed(selection);
  editions.mockImplementationOnce(() => new Promise(() => undefined));
  render(<App />);
  await edit();
  await userEvent.click(screen.getByRole('button', { name: 'Find additional editions and covers' }));
  const signal = editions.mock.calls[0][1];
  await userEvent.click(screen.getByRole('button', { name: 'Close book editor' }));
  expect(signal.aborted).toBe(true);
});

it('keeps an explicit placeholder chosen while a lookup is active', async () => {
  seed();
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<App />);
  const dialog = await edit();
  const placeholder = within(dialog).getByRole('button', {
    name: 'Select placeholder cover',
  });
  placeholder.focus();
  await userEvent.keyboard('{Enter}');
  await act(async () => resolve([work]));
  expect(saved().books[0].coverSelection).toEqual({ kind: 'placeholder' });
  expect(saved().books[0].matchedWorkId).toBeUndefined();
});

it('ignores results after removal', async () => {
  seed();
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Remove Dune' }));
  await act(async () => resolve([work]));
  expect(saved().books).toHaveLength(0);
});

it('ignores pending results when storage recovery resets the board', async () => {
  localStorage.setItem(STORAGE_KEY, 'invalid saved data');
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<App />);
  fireEvent.change(await screen.findByLabelText('Book title and author in natural language'), {
    target: { value: 'Dune | Frank Herbert' },
  });
  await userEvent.click(screen.getByRole('button', { name: '+ Add books' }));
  await userEvent.click(screen.getByRole('button', { name: 'Reset saved data and current list' }));
  await act(async () => resolve([work]));
  expect(saved().books).toHaveLength(0);
});

it('updates clean editor fields after a match but preserves an unsaved draft', async () => {
  seed();
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<App />);
  const dialog = await edit();
  fireEvent.change(within(dialog).getByLabelText('Author'), {
    target: { value: 'My unsaved author' },
  });
  await act(async () => resolve([{ ...work, title: 'Canonical Dune', authors: ['Canonical Author'] }]));
  expect(within(dialog).getByLabelText('Book name')).toHaveValue('Canonical Dune');
  expect(within(dialog).getByLabelText('Author')).toHaveValue('My unsaved author');
  expect(saved().books[0]).toMatchObject({
    title: 'Canonical Dune',
    author: 'Canonical Author',
  });
});

it('serializes searches, skips removed queued books, and continues after errors', async () => {
  persist(importBooks(createBoard(), 'First\nRemoved\nThird'));
  const releases: ((works: WorkCandidate[]) => void)[] = [];
  const reject = new Error('Search unavailable');
  let fail!: (error: Error) => void;
  search
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    )
    .mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
  render(<App />);
  expect(screen.getByRole('status', { name: 'Searching for cover: First' })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Waiting for cover search: Removed' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Remove Removed' }));
  fireEvent.change(screen.getByLabelText('Book title and author in natural language'), { target: { value: 'Fourth' } });
  await userEvent.click(screen.getByRole('button', { name: '+ Add books' }));
  expect(search).toHaveBeenCalledOnce();
  await act(async () => fail(reject));
  expect(screen.getByText(/Search unavailable/)).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Searching for cover: Third' })).toBeInTheDocument();
  await act(async () => releases[0]([]));
  expect(screen.getByRole('status', { name: 'Searching for cover: Fourth' })).toBeInTheDocument();
  await act(async () => releases[1]([]));
  expect(search.mock.calls.map(([book]) => book.title)).toEqual(['First', 'Third', 'Fourth']);
});

it('ignores a pending old identity after editing and retries using the latest fields', async () => {
  seed();
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<App />);
  const dialog = await edit();
  fireEvent.change(within(dialog).getByLabelText('Book name'), {
    target: { value: 'Renamed' },
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await act(async () => resolve([work]));
  await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  expect(search.mock.calls[1][0].title).toBe('Renamed');
  expect(saved().books[0]).toMatchObject({ title: 'Renamed' });
  expect(saved().books[0].coverSelection).toBeUndefined();
});

it('preserves manually saved artwork and allows duplicate edits when saving', async () => {
  const board = seed(selection);
  const other = importBooks(board, 'Other | Author');
  other.books[1].coverSelection = { kind: 'placeholder' };
  persist(other);
  render(<App />);
  const dialog = await edit();
  fireEvent.change(within(dialog).getByLabelText('Book name'), {
    target: { value: 'Other' },
  });
  fireEvent.change(within(dialog).getByLabelText('Author'), {
    target: { value: 'Author' },
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  expect(saved().books[0]).toMatchObject({
    title: 'Other',
    author: 'Author',
    coverSelection: selection,
  });
  expect(saved().books[1]).toEqual(other.books[1]);
  fireEvent.change(within(dialog).getByLabelText('Book name'), {
    target: { value: 'New name' },
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(saved().books[0]).toMatchObject({
    title: 'New name',
    coverSelection: selection,
  });
  fireEvent.change(within(dialog).getByLabelText('Book name'), {
    target: { value: 'Correct title' },
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(search).not.toHaveBeenCalled();
  expect(saved().books[0]).toMatchObject({
    title: 'Correct title',
    author: 'Author',
    coverSelection: selection,
  });
  expect(saved().tiers).toEqual(board.tiers);
});

it('shows only the no-match lookup message without retry or edition search controls', async () => {
  seed();
  render(<App />);
  await screen.findByText('No match', { exact: true });
  const dialog = await edit();
  expect(within(dialog).getByText('No matching works found', { exact: true })).toBeInTheDocument();
  expect(within(dialog).queryByText('Match a book before searching its editions.')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Retry cover search' })).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole('button', {
      name: 'Find additional editions and covers',
    }),
  ).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Upload photo' })).toBeEnabled();
  expect(editions).not.toHaveBeenCalled();
});
