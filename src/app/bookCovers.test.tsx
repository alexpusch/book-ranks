import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { STORAGE_KEY, validateBoard } from '../board/storage';
import { createBoard, importBooks, moveBook, type Board } from '../board/board';
import { coverUrl, type WorkCandidate } from '../integrations/openLibrary/types';
import { openLibraryClient } from '../integrations/openLibrary/client';
import * as localCover from '../books/localCover';

vi.mock('../integrations/openLibrary/client', () => ({
  openLibraryClient: { search: vi.fn(), editions: vi.fn() },
}));
const search = vi.mocked(openLibraryClient.search);
const editions = vi.mocked(openLibraryClient.editions);
const selection = { kind: 'open-library' as const, workId: 'OL1W', coverId: 123, editionId: 'OL1M' };
const work: WorkCandidate = {
  id: 'OL1W', title: 'Dune', authors: ['Frank Herbert'], covers: [{ coverId: 123 }], editions: [], nextCursor: '0',
};
const edition = {
  id: 'OL1M', title: 'Dune', covers: [{ coverId: 456, editionId: 'OL1M' }],
  languages: ['eng'], publishers: ['Publisher'], isbns: [], publicationDate: '2025',
};
beforeEach(() => {
  localStorage.clear();
  search.mockReset().mockResolvedValue([]);
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

it('opens the upload picker and applies local artwork without changing metadata or placements', async () => {
  const board = seed();
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const cover = { kind: 'local' as const, dataUrl: 'data:image/jpeg;base64,Y292ZXI=' };
  const read = vi.spyOn(localCover, 'readLocalCover').mockResolvedValue(cover);
  const rendered = render(<App />);
  const dialog = await edit();
  const input = within(dialog).getByLabelText('Cover photo');
  const click = vi.spyOn(input, 'click');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Upload photo' }));
  expect(click).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { files: [new File(['png'], 'cover.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => resolve([work]));
  expect(saved().books[0]).toMatchObject({ title: 'Dune', author: 'Frank Herbert', coverSelection: cover });
  expect(saved().tiers).toEqual(board.tiers);
  rendered.unmount();
  search.mockClear();
  render(<App />);
  await edit();
  expect(screen.getByRole('button', { name: 'Select your uploaded cover' })).toHaveAttribute('aria-pressed', 'true');
  expect(search).not.toHaveBeenCalled();
  read.mockRestore();
});

it('only captures clipboard images after opting in and supports cancellation and retry', async () => {
  seed(selection);
  render(<App />);
  const dialog = await edit();
  const file = new File(['png'], 'pasted.png', { type: 'image/png' });
  const read = vi.spyOn(localCover, 'readLocalCover').mockResolvedValue({
    kind: 'local', dataUrl: 'data:image/jpeg;base64,Y292ZXI=',
  });
  fireEvent.paste(dialog, { clipboardData: { files: [file] } });
  expect(read).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Paste image' }));
  expect(screen.getByRole('group', { name: 'Paste cover image' })).toHaveFocus();
  fireEvent.paste(dialog, { clipboardData: { files: [] } });
  expect(screen.getByRole('alert')).toHaveTextContent('No image found');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel paste' }));
  fireEvent.paste(dialog, { clipboardData: { files: [file] } });
  expect(read).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Paste image' }));
  fireEvent.paste(dialog, { clipboardData: { files: [file] } });
  await waitFor(() => expect(saved().books[0].coverSelection?.kind).toBe('local'));
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

it('preserves version 1 selections and validates matched work identifiers, not URLs', () => {
  const board = seed(selection);
  board.books[0].matchedWorkId = 'OL1W';
  expect(validateBoard(board)).toEqual(board);
  for (const invalid of [{ ...selection, coverId: -1 }, { ...selection, workId: 'https://evil.invalid' },
    { ...selection, editionId: 'OL1W' }, { ...selection, url: 'https://evil.invalid' }]) {
    expect(() => validateBoard({ ...board, books: [{ ...board.books[0], coverSelection: invalid }] })).toThrow('cover selection');
  }
  expect(() => validateBoard({ ...board, books: [{ ...board.books[0], matchedWorkId: 'https://evil.invalid' }] })).toThrow('matched work');
});

it('renders persisted artwork without metadata lookup, including when the editor opens', async () => {
  seed(selection);
  const { container } = render(<App />);
  expect(container.querySelectorAll(`img[src="${coverUrl(123)}"]`)).toHaveLength(2);
  fireEvent.error(container.querySelector('img')!);
  await userEvent.click(screen.getByRole('button', { name: 'Retry image' }));
  expect(screen.queryByText(/Artwork unavailable/)).not.toBeInTheDocument();
  const dialog = await edit();
  expect(within(dialog).getByRole('group', { name: 'Cover gallery' }).lastElementChild)
    .toHaveTextContent('Your own cover');
  expect(within(dialog).getByRole('button', { name: /Select edition OL1M/ })).toHaveAttribute('aria-pressed', 'true');
  expect(search).not.toHaveBeenCalled();
  expect(editions).not.toHaveBeenCalled();
});

it('applies only search-result metadata and representative artwork without fetching editions or looping', async () => {
  const board = seed();
  search.mockResolvedValueOnce([{ ...work, title: 'Dune: The Novel', authors: ['Frank Herbert', 'Other Author'] }]);
  render(<App />);
  await waitFor(() => expect(saved().books[0]).toMatchObject({
    title: 'Dune: The Novel', author: 'Frank Herbert, Other Author', matchedWorkId: 'OL1W',
    coverSelection: { kind: 'open-library', workId: 'OL1W', coverId: 123 },
  }));
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

it('does not force a candidate when Chrome AI returns no suitable match', async () => {
  seed();
  search.mockResolvedValueOnce([work]);
  vi.mocked(window.LanguageModel!.create).mockResolvedValueOnce({
    prompt: vi.fn().mockResolvedValue('{"workId":null}'), destroy: vi.fn(),
  });
  render(<App />);
  expect(await screen.findByText('Review required')).toBeInTheDocument();
  expect(saved().books[0].matchedWorkId).toBeUndefined();
});

it('reports canonical metadata collisions without merging placements or corrupting saved data', async () => {
  const board = importBooks(seed(), 'Dune: Canonical | Frank Herbert');
  board.books[1].coverSelection = { kind: 'placeholder' };
  persist(board);
  search.mockResolvedValueOnce([{ ...work, title: 'Dune: Canonical' }]);
  render(<App />);
  expect(await screen.findByText(/already in this list/)).toBeInTheDocument();
  expect(saved().books).toHaveLength(2);
  expect(saved().books[0].title).toBe('Dune');
  expect(saved().tiers).toEqual(board.tiers);
});

it('loads editions only on an explicit click and subsequent pages only on another click', async () => {
  seed(selection);
  editions.mockResolvedValueOnce({ editions: [edition], nextCursor: '20' })
    .mockResolvedValueOnce({ editions: [{ ...edition, id: 'OL2M', covers: [{ coverId: 789 }] }], nextCursor: null });
  render(<App />);
  const dialog = await edit();
  expect(editions).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Find additional editions and covers' }));
  const tile = await screen.findByRole('button', { name: /Select edition OL1M.*2025/ });
  expect(tile.parentElement).toHaveTextContent('2025');
  expect(editions).toHaveBeenCalledExactlyOnceWith({ workId: 'OL1W', cursor: '0' }, expect.any(AbortSignal));
  await userEvent.click(screen.getByRole('button', { name: 'More editions and covers' }));
  expect(await screen.findByText('All available editions loaded.')).toBeInTheDocument();
  expect(editions).toHaveBeenLastCalledWith({ workId: 'OL1W', cursor: '20' }, expect.any(AbortSignal));
  await userEvent.click(tile);
  expect(saved().books[0].coverSelection).toEqual({ ...selection, coverId: 456 });
  expect(saved().books[0]).toMatchObject({ title: 'Dune', author: 'Frank Herbert' });
});

it('deduplicates edition artwork while retaining a saved association and its release date', async () => {
  seed(selection);
  editions.mockResolvedValueOnce({
    editions: [{ ...edition, covers: [{ coverId: 123 }] }, { ...edition, id: 'OL2M', covers: [{ coverId: 123 }] }],
    nextCursor: null,
  });
  render(<App />);
  const dialog = await edit();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Find additional editions and covers' }));
  const tile = await screen.findByRole('button', { name: /Select edition OL1M.*2025/ });
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
  search.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(<App />);
  const dialog = await edit();
  const placeholder = within(dialog).getByRole('button', { name: 'Select placeholder cover' });
  placeholder.focus();
  await userEvent.keyboard('{Enter}');
  await act(async () => resolve([work]));
  expect(saved().books[0].coverSelection).toEqual({ kind: 'placeholder' });
  expect(saved().books[0].matchedWorkId).toBeUndefined();
});

it('ignores results after removal', async () => {
  seed();
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Remove Dune' }));
  await act(async () => resolve([work]));
  expect(saved().books).toHaveLength(0);
});

it('ignores pending results when storage recovery resets the board', async () => {
  localStorage.setItem(STORAGE_KEY, 'invalid saved data');
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(<App />);
  fireEvent.change(await screen.findByLabelText('Book title and author in natural language'), { target: { value: 'Dune | Frank Herbert' } });
  await userEvent.click(screen.getByRole('button', { name: '+ Add book' }));
  await userEvent.click(screen.getByRole('button', { name: 'Reset saved data and current list' }));
  await act(async () => resolve([work]));
  expect(saved().books).toHaveLength(0);
});

it('updates clean editor fields after a match but preserves an unsaved draft', async () => {
  seed();
  let resolve!: (works: WorkCandidate[]) => void;
  search.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(<App />);
  const dialog = await edit();
  fireEvent.change(within(dialog).getByLabelText('Author'), { target: { value: 'My unsaved author' } });
  await act(async () => resolve([{ ...work, title: 'Canonical Dune', authors: ['Canonical Author'] }]));
  expect(within(dialog).getByLabelText('Book name')).toHaveValue('Canonical Dune');
  expect(within(dialog).getByLabelText('Author')).toHaveValue('My unsaved author');
  expect(saved().books[0]).toMatchObject({ title: 'Canonical Dune', author: 'Canonical Author' });
});

it('serializes searches, skips removed queued books, and continues after errors', async () => {
  persist(importBooks(createBoard(), 'First\nRemoved\nThird'));
  const releases: ((works: WorkCandidate[]) => void)[] = [];
  const reject = new Error('Search unavailable');
  let fail!: (error: Error) => void;
  search.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
    .mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
  render(<App />);
  expect(screen.getByRole('status', { name: 'Searching for cover: First' })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Waiting for cover search: Removed' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Remove Removed' }));
  fireEvent.change(screen.getByLabelText('Book title and author in natural language'), { target: { value: 'Fourth' } });
  await userEvent.click(screen.getByRole('button', { name: '+ Add book' }));
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
  search.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(<App />);
  const dialog = await edit();
  fireEvent.change(within(dialog).getByLabelText('Book name'), { target: { value: 'Renamed' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await act(async () => resolve([work]));
  await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  expect(search.mock.calls[1][0].title).toBe('Renamed');
  expect(saved().books[0]).toMatchObject({ title: 'Renamed' });
  expect(saved().books[0].coverSelection).toBeUndefined();
});

it('preserves manually saved artwork, rejects duplicate edits, and retries with unsaved fields', async () => {
  const board = seed(selection);
  const other = importBooks(board, 'Other | Author');
  other.books[1].coverSelection = { kind: 'placeholder' };
  persist(other);
  render(<App />);
  const dialog = await edit();
  fireEvent.change(within(dialog).getByLabelText('Book name'), { target: { value: 'Other' } });
  fireEvent.change(within(dialog).getByLabelText('Author'), { target: { value: 'Author' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('already');
  fireEvent.change(within(dialog).getByLabelText('Book name'), { target: { value: 'New name' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(saved().books[0]).toMatchObject({ title: 'New name', coverSelection: selection });
  fireEvent.change(within(dialog).getByLabelText('Book name'), { target: { value: 'Correct title' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Retry cover search' }));
  await waitFor(() => expect(search).toHaveBeenCalledOnce());
  expect(search.mock.calls[0][0]).toMatchObject({ title: 'Correct title', author: 'Author' });
  expect(saved().books[0].coverSelection).toBeUndefined();
  expect(saved().tiers).toEqual(board.tiers);
});
