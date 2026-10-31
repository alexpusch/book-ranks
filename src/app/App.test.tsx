import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { exportJpeg } from '../export/exportJpeg';
import { STORAGE_KEY } from '../board/storage';
import type { BookLanguageModel } from '../integrations/chromeAi/prompt';
import { createBoard, importBooks, moveBook, queueBook } from '../board/board';
import { openLibraryClient } from '../integrations/openLibrary/client';

vi.mock('../export/exportJpeg', async (importOriginal) => ({ ...await importOriginal<typeof import('../export/exportJpeg')>(), exportJpeg: vi.fn() }));
vi.mock('../integrations/openLibrary/client', () => ({
  openLibraryClient: { search: vi.fn(), searchPage: vi.fn(), editions: vi.fn() },
}));

beforeEach(() => {
  window.history.replaceState(null, '', '/?ai=true');
  localStorage.clear();
  vi.mocked(openLibraryClient.search).mockReset().mockResolvedValue([]);
  vi.mocked(openLibraryClient.searchPage).mockReset().mockImplementation(async (input, signal) => ({
    works: await openLibraryClient.search(input, signal), nextCursor: null,
  }));
  vi.mocked(openLibraryClient.editions).mockReset().mockResolvedValue({ editions: [], nextCursor: null });
});

describe('book list UI', () => {
  it('clears all ranks into the gallery and restores the cleared board on reload', async () => {
    let board = importBooks(createBoard(), 'One\nTwo\nThree\nFour');
    board.books.forEach((book) => { book.coverSelection = { kind: 'placeholder' }; });
    const [one, two, three, four] = board.gallery;
    board = moveBook(board, two, 'tier-S');
    board = moveBook(board, one, 'tier-S');
    board = moveBook(board, three, 'tier-E');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    const app = render(<App />);
    const button = within(screen.getByRole('region', { name: 'Rank the books' })).getByRole('button', { name: 'Clear all' });
    expect(button).toBeEnabled();
    expect(button.parentElement).toHaveTextContent('3 of 4 books ranked');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    await userEvent.setup().click(button);

    expect(screen.getByText('0 of 4 books ranked')).toBeVisible();
    expect(button).toBeDisabled();
    expect(within(screen.getByRole('region', { name: 'Your books' }))
      .getAllByRole('article').map((card) => card.getAttribute('data-book-id'))).toEqual([four, two, one, three]);
    for (const tier of board.tiers) {
      expect(within(screen.getByRole('region', { name: `Tier ${tier.name}` })).queryByRole('article')).not.toBeInTheDocument();
    }
    expect(screen.getByText('All ranked books returned to your reading pile.')).toHaveAttribute('role', 'status');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      ...board, gallery: [four, two, one, three], tiers: board.tiers.map((tier) => ({ ...tier, bookIds: [] })),
    });
    app.unmount();
    render(<App />);
    expect(screen.getByText('0 of 4 books ranked')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Your books' })).getAllByRole('article')).toHaveLength(4);
  });

  it('disables clearing when there are no ranked books', () => {
    render(<App />);
    expect(within(screen.getByRole('region', { name: 'Rank the books' })).getByRole('button', { name: 'Clear all' })).toBeDisabled();
  });

  it('clears unranked books above the gallery, preserving ranks and drafts across reload', async () => {
    window.history.replaceState(null, '', '/');
    let board = importBooks(createBoard(), 'One\nTwo\nThree');
    board.books.forEach((book) => { book.coverSelection = { kind: 'placeholder' }; });
    board = moveBook(board, board.gallery[1], 'tier-S');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    const user = userEvent.setup();
    const app = render(<App />);
    const entry = screen.getByRole('region', { name: 'Add books' });
    const gallery = screen.getByRole('region', { name: 'Your books' });
    const button = within(gallery).getByRole('button', { name: 'Clear all' });
    expect(within(entry).queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
    expect(button.parentElement).toHaveClass('gallery-toolbar');
    expect(button).toBeEnabled();
    await user.type(screen.getByLabelText('Book name'), 'Manual draft');
    await user.click(screen.getByRole('button', { name: 'Bulk insert' }));
    await user.type(screen.getByLabelText('Books to add'), 'Bulk draft');
    await user.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByLabelText('Books to add')).toHaveValue('Bulk draft');
    await user.click(screen.getByRole('button', { name: 'Manual entry' }));
    expect(screen.getByLabelText('Book name')).toHaveValue('Manual draft');
    expect(within(screen.getByRole('region', { name: 'Your books' })).queryByRole('article')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Tier S' })).getByRole('article', { name: 'Two by Unknown author' })).toBeVisible();
    expect(screen.getByText('1 of 1 books ranked')).toBeVisible();
    expect(screen.getByText('All unranked books removed from your reading pile.')).toHaveAttribute('role', 'status');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ ...board, books: [board.books[1]], gallery: [] });
    app.unmount();
    render(<App />);
    expect(within(screen.getByRole('region', { name: 'Your books' })).getByRole('button', { name: 'Clear all' })).toBeDisabled();
    expect(screen.getByText('1 of 1 books ranked')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Tier S' })).getByRole('article', { name: 'Two by Unknown author' })).toBeVisible();
  });

  it.each(['/', '/?ai=false', '/?ai=', '/?ai=True', '/?other=true', '/?other=ai%3Dtrue'])(
    'hides AI entry at %s even with a saved AI preference and an available model',
    async (url) => {
      window.history.replaceState(null, '', url);
      localStorage.setItem('shelf-life.entry-mode', 'ai');
      render(<App />);
      expect(screen.getByRole('button', { name: 'Bulk insert' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'AI assisted' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Book title and author in natural language')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'About the Prompt API' })).not.toBeInTheDocument();
      expect(window.LanguageModel?.availability).not.toHaveBeenCalled();
      await userEvent.setup().type(screen.getByLabelText('Book name'), 'Manual book');
      await userEvent.setup().click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
      expect(await screen.findByRole('article', { name: 'Manual book by Unknown author' })).toBeInTheDocument();
      expect(localStorage.getItem('shelf-life.entry-mode')).toBe('ai');
    },
  );

  it('enables AI entry when ai=true appears alongside other URL parameters', async () => {
    window.history.replaceState(null, '', '/?source=share&ai=true');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'AI assisted' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restores both dark and light theme choices after remounting', async () => {
    const user = userEvent.setup();
    let app = render(<App />);
    for (const dark of [true, false]) {
      await user.click(screen.getByRole('switch', { name: dark ? 'Dark mode' : 'Light mode' }));
      expect(localStorage.getItem('shelf-life.theme')).toBe(dark ? 'dark' : 'light');
      app.unmount();
      app = render(<App />);
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', String(dark));
      expect(document.documentElement).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
    }
  });

  it.each(['Manual entry', 'AI assisted', 'Bulk insert'])('restores the explicit %s choice instead of the AI default', async (mode) => {
    const user = userEvent.setup();
    const app = render(<App />);
    await user.click(await screen.findByRole('button', { name: mode }));
    expect(localStorage.getItem('shelf-life.entry-mode')).toBe(mode === 'Manual entry' ? 'structured' : mode === 'Bulk insert' ? 'bulk' : 'ai');
    app.unmount();
    vi.stubGlobal('LanguageModel', { availability: vi.fn().mockResolvedValue('downloadable') });
    render(<App />);
    expect(await screen.findByRole('button', { name: mode })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses manual entry when AI is unavailable without losing the saved AI choice', async () => {
    localStorage.setItem('shelf-life.entry-mode', 'ai');
    vi.stubGlobal('LanguageModel', undefined);
    const app = render(<App />);
    expect(screen.getByLabelText('Book name')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'AI assisted' })).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText('Book name'), 'Manual draft');
    expect(localStorage.getItem('shelf-life.entry-mode')).toBe('ai');
    app.unmount();
    vi.stubGlobal('LanguageModel', { availability: vi.fn().mockResolvedValue('available') });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'AI assisted' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not persist automatic entry defaults', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: 'AI assisted' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('shelf-life.entry-mode')).toBeNull();
    expect(localStorage.getItem('shelf-life.theme')).toBeNull();
  });

  it('reports invalid saved preferences and replaces them only on explicit selection', async () => {
    localStorage.setItem('shelf-life.theme', 'invalid');
    localStorage.setItem('shelf-life.entry-mode', 'invalid');
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('shelf-life.theme')).toBe('invalid');
    await user.click(screen.getByRole('switch'));
    await user.click(await screen.findByRole('button', { name: 'Manual entry' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(localStorage.getItem('shelf-life.theme')).toBe('dark');
    expect(localStorage.getItem('shelf-life.entry-mode')).toBe('structured');
  });

  it('reports preference write failures while still switching modes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Manual entry' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Manual entry' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByLabelText('Book name')).toBeVisible();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    for (const alert of screen.getAllByRole('alert')) {
      expect(alert).toHaveTextContent('Could not save your preference. Storage full');
    }
  });

  it('reports preference read failures while retaining usable defaults', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === STORAGE_KEY) return null;
      throw new Error('Storage unavailable');
    });
    render(<App />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(await screen.findByRole('button', { name: 'AI assisted' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    for (const alert of screen.getAllByRole('alert')) {
      expect(alert).toHaveTextContent('Could not load your preference. Storage unavailable');
    }
  });

  it('toggles dark mode next to tier settings and exports the current theme', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    const toggle = screen.getByRole('switch', { name: 'Dark mode' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleName('Dark mode');
    expect(toggle).toHaveTextContent('');
    expect(toggle.querySelector('svg circle')).not.toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(toggle.previousElementSibling).toBe(screen.getByRole('button', { name: /Tier settings/ }));

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveAccessibleName('Light mode');
    expect(toggle.querySelector('svg circle')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(exportJpeg).toHaveBeenCalledWith(expect.any(HTMLElement), false);

    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleName('Dark mode');
    expect(toggle.querySelector('svg circle')).not.toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('does not report missing Chrome AI after adding a manual book in Safari with search results', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Version/18.0 Safari/605.1.15');
    vi.stubGlobal('LanguageModel', undefined);
    vi.mocked(openLibraryClient.search).mockResolvedValue([{
      id: 'OL123W', title: 'Hyperion', authors: ['Dan Simmons'], covers: [{ coverId: 123 }],
      editions: [], nextCursor: null,
    }]);
    vi.mocked(openLibraryClient.editions).mockResolvedValue({
      editions: [{
        id: 'OL456M', title: 'Hyperion', publicationDate: '2025-10-01', covers: [{ coverId: 456, editionId: 'OL456M' }],
        languages: [], publishers: [], isbns: [],
      }], nextCursor: null,
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Book name'), 'Hyperion');
    await user.type(screen.getByLabelText('Author (optional)'), 'Dan');
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    expect(await screen.findByRole('article', { name: 'Hyperion by Dan Simmons' })).toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).books[0]).toMatchObject({
        matchedWorkId: 'OL123W', coverSelection: { kind: 'open-library', workId: 'OL123W', coverId: 456, editionId: 'OL456M' },
      });
    });
    expect(screen.queryAllByText(/Chrome built-in AI is not available/)).toHaveLength(0);
  });

  it('shows your books only as an empty gallery placeholder, without a heading or subtitle', async () => {
    const user = userEvent.setup();
    render(<App />);
    const gallery = screen.getByRole('region', { name: 'Your books' });
    expect(within(gallery).getByText('your books', { exact: true })).toBeVisible();
    expect(within(gallery).getByText('drag to rank', { exact: true })).toBeVisible();
    expect(within(gallery).queryByRole('heading')).not.toBeInTheDocument();
    expect(gallery).not.toHaveTextContent('The reading pile');
    expect(gallery).not.toHaveTextContent('Unranked for now');
    expect(gallery).not.toHaveTextContent('SCROLL TO EXPLORE');

    await user.click(await screen.findByRole('button', { name: 'Manual entry' }));
    await user.type(screen.getByLabelText('Book name', { exact: true }), 'Dune');
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    expect(within(gallery).queryByText('your books', { exact: true })).not.toBeInTheDocument();
    expect(within(gallery).getByText('drag to rank', { exact: true })).toBeVisible();
    await user.click(within(gallery).getByRole('button', { name: 'Remove Dune' }));
    expect(within(gallery).getByText('your books', { exact: true })).toBeVisible();
  });

  it('returns a removed ranked book to the gallery, persists it, and only deletes it from the gallery', async () => {
    const rankedBook = { id: 'ranked', title: 'Dune', author: 'Frank Herbert', coverSelection: { kind: 'placeholder' } };
    const unrankedBook = { id: 'unranked', title: 'Existing', author: 'Author', coverSelection: { kind: 'placeholder' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1, books: [rankedBook, unrankedBook],
      gallery: ['unranked'], tiers: [{ id: 'tier-S', name: 'S', color: '#aabbcc', bookIds: ['ranked'] }],
    }));
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    const tier = screen.getByRole('region', { name: 'Tier S' });
    await user.click(within(tier).getByRole('button', { name: 'Remove Dune' }));

    expect(within(tier).queryByRole('article')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Your books' }))
      .getAllByRole('article').map((card) => card.getAttribute('data-book-id'))).toEqual(['unranked', 'ranked']);
    expect(screen.getByText(/0 of 2 books ranked/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      books: [rankedBook, unrankedBook], gallery: ['unranked', 'ranked'],
      tiers: [{ id: 'tier-S', bookIds: [] }],
    });

    unmount();
    render(<App />);
    const gallery = screen.getByRole('region', { name: 'Your books' });
    expect(within(gallery).getByRole('article', { name: 'Dune by Frank Herbert' })).toBeInTheDocument();
    await user.click(within(gallery).getByRole('button', { name: 'Remove Dune' }));
    expect(screen.queryByRole('article', { name: 'Dune by Frank Herbert' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      books: [unrankedBook], gallery: ['unranked'],
    });
  });

  it('keeps book entry visible with a non-interactive heading', async () => {
    const user = userEvent.setup();
    render(<App />);
    const heading = screen.getByRole('heading', { name: 'Add books' });
    const input = await screen.findByLabelText('Book title and author in natural language');
    expect(screen.queryByRole('button', { name: 'Add books' })).not.toBeInTheDocument();
    expect(input).toBeVisible();
    await user.type(input, 'My pasted books');
    await user.click(heading);
    expect(input).toBeVisible();
    expect(input).toHaveValue('My pasted books');
    expect(screen.getByRole('button', { name: /^\+ Add books?$/ })).toBeVisible();
  });

  it('shows a button loader without adding cards until the complete AI batch is extracted', async () => {
    const resolvePrompts: ((value: string) => void)[] = [];
    const prompt = vi.fn(() => new Promise<string>((resolve) => { resolvePrompts.push(resolve); }));
    const model: BookLanguageModel = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({ prompt, destroy: vi.fn() }),
    };
    vi.stubGlobal('LanguageModel', model);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1, books: [{ id: 'existing', title: 'Existing', author: 'Author', coverSelection: { kind: 'placeholder' } }],
      gallery: ['existing'], tiers: [{ id: 'tier-S', name: 'S', color: '#aabbcc', bookIds: [] }],
    }));
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText('Book title and author in natural language');
    const raw = 'Long library text\n'.repeat(800);
    fireEvent.change(input, { target: { value: raw } });
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    const button = screen.getByRole('button', { name: '+ Add books' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('.entry-spinner')).toBeInTheDocument();
    expect(input).toHaveValue(raw);
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Manual entry' })).toBeEnabled();
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Remove Existing' }));
    await act(async () => resolvePrompts[0](JSON.stringify({
      books: [{ title: 'The Spear Cuts Through Water', author: 'Simon Jimenez' }],
    })));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    await act(async () => resolvePrompts[1](JSON.stringify({ books: [{ title: 'Another book', author: '' }] })));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(3));
    await act(async () => resolvePrompts[2](JSON.stringify({ books: [{ title: 'Last book', author: '' }] })));
    expect(screen.getByRole('article', { name: 'The Spear Cuts Through Water by Simon Jimenez' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Another book by Unknown author' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Last book by Unknown author' })).toBeInTheDocument();
    expect(screen.queryByText('Existing')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(saved.books).toHaveLength(3);
      expect(saved.books.every((book: { pendingInput?: string }) => book.pendingInput === undefined)).toBe(true);
    });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-busy', 'false');
    expect(button.querySelector('.entry-spinner')).not.toBeInTheDocument();
  });

  it('keeps failed AI input in the form and allows retry without adding a card', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText('Book title and author in natural language');
    vi.stubGlobal('LanguageModel', undefined);
    await user.type(input, 'Some unstructured book text');
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Chrome built-in AI is not available');
    expect(input).toHaveValue('Some unstructured book text');
    expect(input).toBeEnabled();
    expect(screen.getByRole('button', { name: /^\+ Add books?$/ })).toBeEnabled();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add books' }).querySelector('.entry-spinner')).not.toBeInTheDocument();
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({
        prompt: vi.fn().mockResolvedValue(JSON.stringify({ books: [{ title: 'A resolved book', author: 'Author' }] })),
        destroy: vi.fn(),
      }),
    });
    await user.click(screen.getByRole('button', { name: '+ Add books' }));
    expect(await screen.findByRole('article', { name: 'A resolved book by Author' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('cancels form extraction when saved-data recovery resets the list', async () => {
    let finish!: (response: string) => void;
    const prompt = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({ prompt, destroy: vi.fn() }),
    });
    localStorage.setItem(STORAGE_KEY, 'invalid');
    const user = userEvent.setup();
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Book title and author in natural language'), {
      target: { value: 'Old library text' },
    });
    await user.click(screen.getByRole('button', { name: '+ Add books' }));
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Reset saved data and current list' }));
    await act(async () => finish('{"books":[{"title":"Stale book","author":""}]}'));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).books).toHaveLength(0);
    expect(screen.getByRole('button', { name: '+ Add books' })).toBeEnabled();
  });

  it('skips removed pending entries and ignores late extraction results without blocking the remaining queue', async () => {
    const resolvePrompts: ((value: string) => void)[] = [];
    const prompt = vi.fn((_text: string) => new Promise<string>((resolve) => resolvePrompts.push(resolve)));
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({ prompt, destroy: vi.fn() }),
    });
    let board = createBoard();
    for (const text of ['Active book', 'Queued book', 'Remaining book']) board = queueBook(board, text);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Remove Queued book' }));
    await user.click(screen.getByRole('button', { name: 'Remove Active book' }));
    await act(async () => resolvePrompts[0](JSON.stringify({ books: [{ title: 'Deleted result', author: '' }] })));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(prompt.mock.calls[1][0]).toBe('Remaining book');
    await act(async () => resolvePrompts[1](JSON.stringify({ books: [{ title: 'Remaining', author: 'Author' }] })));
    expect(screen.getByRole('article', { name: 'Remaining by Author' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.queryByText('Deleted result')).not.toBeInTheDocument();
  });

  it('keeps explicit artwork chosen during extraction and ignores results after manual metadata edits', async () => {
    const resolvePrompts: ((value: string) => void)[] = [];
    const prompt = vi.fn(() => new Promise<string>((resolve) => resolvePrompts.push(resolve)));
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({ prompt, destroy: vi.fn() }),
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queueBook(queueBook(createBoard(), 'Raw book'), 'Second raw book')));
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Edit Raw book' }));
    await user.click(screen.getByRole('button', { name: 'Select placeholder cover' }));
    await act(async () => resolvePrompts[0](JSON.stringify({ books: [{ title: 'Normalized', author: 'Author' }] })));
    expect(screen.getByRole('article', { name: 'Normalized by Author' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).books[0].coverSelection).toEqual({ kind: 'placeholder' });
    expect(openLibraryClient.search).not.toHaveBeenCalled();

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Edit Second raw book' }));
    const editor = screen.getByRole('dialog');
    await user.clear(within(editor).getByLabelText('Book name'));
    await user.type(within(editor).getByLabelText('Book name'), 'Manual correction');
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Close book editor' }));
    await act(async () => resolvePrompts[1](JSON.stringify({ books: [{ title: 'Stale result', author: '' }] })));
    expect(screen.getByRole('article', { name: 'Manual correction by Unknown author' })).toBeInTheDocument();
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
  });

  it('resumes saved pending input after reload', async () => {
    const board = queueBook(createBoard(), 'Saved title | Saved author');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    render(<App />);
    expect(await screen.findByRole('article', { name: 'Saved title by Saved author' }, { timeout: 5000 })).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.books[0]).toMatchObject({ id: board.books[0].id, title: 'Saved title', author: 'Saved author' });
    expect(saved.books[0].pendingInput).toBeUndefined();
  });

  it('starts with book entry and supports import, drag-only ordering, duplicates, removal, and persistence', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByRole('main').firstElementChild).toHaveClass('entry-panel');
    for (const book of ['Dune | Frank Herbert', 'Piranesi']) {
      await user.type(await screen.findByLabelText('Book title and author in natural language'), book);
      await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    }
    expect(screen.getByText(/0 of 2 books ranked/)).toBeInTheDocument();
    const gallery = screen.getByRole('region', { name: 'Your books' });
    expect(within(gallery).getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(gallery).getByRole('button', { name: 'Drag Dune' })).not.toHaveTextContent('Dune');
    for (const card of within(gallery).getAllByRole('article')) {
      expect(within(card).getAllByRole('button')).toHaveLength(3);
      expect(within(card).getByRole('button', { name: /^Drag / })).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: /^Remove / })).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: /^Edit / })).toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: /^Choose cover/ })).not.toBeInTheDocument();
      expect(card).not.toHaveTextContent(/\d+\s*\/\s*\d+/);
    }
    await user.type(screen.getByLabelText('Book title and author in natural language'), 'Dune | Frank Herbert');
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    await waitFor(() => expect(within(gallery).getAllByRole('button', { name: 'Remove Dune' })).toHaveLength(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(gallery).getAllByRole('article')).toHaveLength(3);
    await user.click(within(gallery).getAllByRole('button', { name: 'Remove Dune' })[0]);
    expect(within(gallery).getByRole('button', { name: 'Remove Dune' })).toBeInTheDocument();
    await user.click(within(gallery).getByRole('button', { name: 'Remove Dune' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).books).toHaveLength(1));
  });

  it.each([
    ['Chrome', 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36'],
    ['Safari', 'Mozilla/5.0 Version/18.0 Safari/605.1.15'],
    ['Firefox', 'Mozilla/5.0 Firefox/140.0'],
    ['Edge', 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0'],
  ])('uses Prompt API support rather than the browser name in %s', async (_browser, userAgent) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'AI assisted' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Book title and author in natural language').tagName).toBe('TEXTAREA');
    expect(screen.getByRole('link', { name: 'About the Prompt API' })).toHaveAttribute('href', 'https://developer.chrome.com/docs/ai/prompt-api');
  });

  it.each(['available', 'downloadable', 'downloading'] as const)('defaults to AI only for a downloaded model (%s) without creating a session', async (availability) => {
    vi.mocked(window.LanguageModel!.availability).mockResolvedValue(availability);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'AI assisted' })).toHaveAttribute('aria-pressed', String(availability === 'available'));
    const modes = screen.getByRole('group', { name: 'Book addition mode' });
    expect(within(modes).getAllByRole('button').map((button) => button.textContent)).toEqual(['Manual entry', 'AI assisted', 'Bulk insert']);
    expect(screen.getByRole('button', { name: 'Manual entry' })).toHaveAttribute('aria-pressed', String(availability !== 'available'));
    expect(window.LanguageModel!.create).not.toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    if (availability === 'available') {
      expect(screen.queryByText('This will require initial Gemini Nano download')).not.toBeInTheDocument();
    }
  });

  it.each(['downloadable', 'downloading'] as const)('shows a yellow download warning with an icon when the model is %s', async (availability) => {
    vi.mocked(window.LanguageModel!.availability).mockResolvedValue(availability);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Manual entry' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('This will require initial Gemini Nano download')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'AI assisted' }));
    const warning = screen.getByText('This will require initial Gemini Nano download');
    expect(warning).toHaveClass('model-download-warning');
    expect(warning.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText('Book title and author in natural language')).toBeVisible();
    expect(window.LanguageModel!.create).not.toHaveBeenCalled();
  });

  it.each(['downloadable', 'downloading', 'available'] as const)('shows download progress only for an actual download, not a cached %s session', async (availability) => {
    const model = window.LanguageModel!;
    vi.mocked(model.availability).mockResolvedValue(availability);
    let reportProgress!: (event: { loaded: number }) => void;
    let finishCreation!: () => void;
    let finishPrompt!: () => void;
    const prompt = vi.fn(() => new Promise<string>((resolve) => {
      finishPrompt = () => resolve(JSON.stringify({ books: [{ title: 'Dune', author: '' }] }));
    }));
    vi.mocked(model.create).mockImplementationOnce((options) => {
      options.monitor({ addEventListener: (_type, listener) => { reportProgress = listener; } });
      return new Promise((resolve) => { finishCreation = () => resolve({ prompt, destroy: vi.fn() }); });
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'AI assisted' }));
    await user.type(await screen.findByLabelText('Book title and author in natural language'), 'Dune');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    await waitFor(() => expect(model.create).toHaveBeenCalledOnce());
    if (availability !== 'available') {
      const progress = screen.getByRole('progressbar', { name: /Downloading Chrome AI model/ });
      expect(progress).toHaveAttribute('value', '0');
      expect(progress.parentElement?.previousElementSibling).toHaveClass('bulk-entry');
    }
    act(() => reportProgress({ loaded: 0.42 }));
    if (availability === 'available') expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    else {
      expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0.42');
      expect(screen.getByText('42%')).toBeVisible();
    }
    expect(screen.getByLabelText('Book title and author in natural language')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^\+ Add books?$/ })).toBeDisabled();
    vi.mocked(model.availability).mockResolvedValue('available');
    await act(async () => finishCreation());
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('This will require initial Gemini Nano download')).not.toBeInTheDocument();
    act(() => reportProgress({ loaded: 1 }));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await act(async () => finishPrompt());
    expect(await screen.findByRole('article', { name: 'Dune by Unknown author' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Book title and author in natural language'), 'Piranesi');
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    expect(await screen.findByRole('article', { name: 'Piranesi by Unknown author' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it.each(['failure', 'cancellation'] as const)('clears download progress on %s without adding a card', async (outcome) => {
    const model = window.LanguageModel!;
    vi.mocked(model.availability).mockResolvedValue('downloadable');
    let failDownload!: () => void;
    vi.mocked(model.create).mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
      failDownload = () => reject(new Error('Model download failed'));
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const user = userEvent.setup();
    const app = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'AI assisted' }));
    await user.type(await screen.findByLabelText('Book title and author in natural language'), 'Dune');
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    expect(await screen.findByRole('progressbar')).toBeVisible();
    if (outcome === 'failure') {
      await act(async () => failDownload());
      expect(await screen.findByRole('alert')).toHaveTextContent('Model download failed');
    } else {
      app.unmount();
      expect(vi.mocked(model.create).mock.calls[0][0].signal.aborted).toBe(true);
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it.each(['missing', 'unavailable', 'rejected'] as const)('keeps manual and bulk modes available when the Prompt API is %s', async (state) => {
    if (state === 'missing') vi.stubGlobal('LanguageModel', undefined);
    else if (state === 'unavailable') vi.mocked(window.LanguageModel!.availability).mockResolvedValue('unavailable');
    else vi.mocked(window.LanguageModel!.availability).mockRejectedValue(new Error('Availability check failed'));
    await act(async () => { render(<App />); });
    expect(screen.queryByRole('button', { name: 'AI assisted' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manual entry' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Bulk insert' })).toBeEnabled();
    expect(screen.getByLabelText('Book name')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'About the Prompt API' })).not.toBeInTheDocument();
    if (state === 'rejected') expect(screen.getByRole('alert')).toHaveTextContent('Could not check Chrome AI availability. Availability check failed');
  });

  it('keeps manual entry available during the check and preserves a manual draft when support resolves', async () => {
    let resolveAvailability!: (value: 'available') => void;
    vi.mocked(window.LanguageModel!.availability).mockReturnValue(new Promise((resolve) => { resolveAvailability = resolve; }));
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('button', { name: 'AI assisted' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manual entry' })).toBeVisible();
    await user.type(screen.getByLabelText('Book name'), 'Manual draft');
    await act(async () => { resolveAvailability('available'); });
    expect(screen.getByRole('button', { name: 'AI assisted' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Book name')).toHaveValue('Manual draft');
  });

  it('adds structured details without AI, trims whitespace, supports missing authors and duplicates, and rejects invalid books', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    const user = userEvent.setup();
    render(<App />);
    const title = screen.getByLabelText('Book name');
    const author = screen.getByLabelText('Author (optional)');
    const add = screen.getByRole('button', { name: /^\+ Add books?$/ });
    await user.type(title, '   ');
    await user.click(add);
    expect(screen.getByRole('alert')).toHaveTextContent('title cannot be empty');
    await user.clear(title);
    await user.type(title, '  Piranesi  ');
    await user.type(author, '  Susanna   Clarke ');
    await user.click(add);
    expect(screen.getByRole('article', { name: 'Piranesi by Susanna Clarke' })).toBeInTheDocument();
    expect(title).toHaveValue('');
    expect(author).toHaveValue('');
    await user.type(title, 'piranesi');
    await user.type(author, 'SUSANNA CLARKE');
    await user.click(add);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'piranesi by SUSANNA CLARKE' })).toBeInTheDocument();
    expect(title).toHaveValue('');
    expect(author).toHaveValue('');
    await user.type(title, 'Another book');
    await user.click(title);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('article', { name: 'Another book by Unknown author' })).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).books).toHaveLength(3));
  });

  it('bulk inserts every line into the gallery without AI and persists the books and mode', async () => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('LanguageModel', undefined);
    const user = userEvent.setup();
    const app = render(<App />);
    await user.click(screen.getByRole('button', { name: 'Bulk insert' }));
    const input = screen.getByLabelText('Books to add');
    expect(input.tagName).toBe('TEXTAREA');
    expect(input).toHaveAccessibleDescription(/book title \| author\(s\) name/);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    fireEvent.change(input, { target: { value: '\n Dune | Frank   Herbert \r\nGood Omens | Terry Pratchett, Neil Gaiman\nPiranesi\nDune | Frank Herbert\n' } });
    await user.click(screen.getByRole('button', { name: '+ Add books' }));
    expect(screen.getAllByRole('article', { name: 'Dune by Frank Herbert' })).toHaveLength(2);
    expect(screen.getByRole('article', { name: 'Good Omens by Terry Pratchett, Neil Gaiman' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Piranesi by Unknown author' })).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(screen.getByText('Added 4 books to your reading pile.')).toHaveAttribute('role', 'status');
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(saved.books).toHaveLength(4);
      expect(saved.gallery).toEqual(saved.books.map((book: { id: string }) => book.id));
    });
    await waitFor(() => expect(openLibraryClient.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Good Omens', author: 'Terry Pratchett, Neil Gaiman' }), expect.any(AbortSignal),
    ));
    app.unmount();
    render(<App />);
    expect(screen.getByRole('button', { name: 'Bulk insert' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Books to add')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it.each(['', ' \n ', 'Valid | Author\n | Author', 'Valid | Author\nBad | Author | Extra'])(
    'rejects invalid bulk input atomically and preserves the draft (%j)', async (text) => {
      vi.stubGlobal('LanguageModel', undefined);
      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByRole('button', { name: 'Bulk insert' }));
      const input = screen.getByLabelText('Books to add');
      fireEvent.change(input, { target: { value: text } });
      await user.click(screen.getByRole('button', { name: '+ Add books' }));
      expect(screen.getByRole('alert')).toHaveTextContent(text.includes('Valid') ? 'Line 2:' : 'Enter at least one book title.');
      expect(input).toHaveValue(text);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
      expect(openLibraryClient.search).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Manual entry' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Bulk insert' }));
      expect(screen.getByLabelText('Books to add')).toHaveValue(text);
    },
  );

  it('preserves a bulk draft and selection when the AI availability check completes', async () => {
    let resolveAvailability!: (value: 'available') => void;
    vi.mocked(window.LanguageModel!.availability).mockReturnValue(new Promise((resolve) => { resolveAvailability = resolve; }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Bulk insert' }));
    await user.type(screen.getByLabelText('Books to add'), 'Dune | Frank Herbert');
    await act(async () => { resolveAvailability('available'); });
    expect(screen.getByRole('button', { name: 'Bulk insert' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'AI assisted' }));
    await user.click(screen.getByRole('button', { name: 'Bulk insert' }));
    expect(screen.getByLabelText('Books to add')).toHaveValue('Dune | Frank Herbert');
    await user.click(screen.getByRole('button', { name: '+ Add books' }));
    expect(screen.getByText('Added 1 book to your reading pile.')).toHaveAttribute('role', 'status');
  });

  it('preserves independent drafts across mode changes and clears mode-specific errors', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Book title and author in natural language'), 'AI draft');
    await user.click(screen.getByRole('button', { name: 'Manual entry' }));
    await user.type(screen.getByLabelText('Book name'), 'Structured draft');
    await user.type(screen.getByLabelText('Author (optional)'), 'Draft author');
    await user.click(screen.getByRole('button', { name: 'AI assisted' }));
    expect(screen.getByLabelText('Book title and author in natural language')).toHaveValue('AI draft');
    await user.click(screen.getByRole('button', { name: 'Manual entry' }));
    expect(screen.getByLabelText('Book name')).toHaveValue('Structured draft');
    expect(screen.getByLabelText('Author (optional)')).toHaveValue('Draft author');
    await user.clear(screen.getByLabelText('Book name'));
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'AI assisted' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('adds all AI-extracted books together before covers finish and persists the full batch', async () => {
    let finishSearch!: () => void;
    vi.mocked(openLibraryClient.search).mockImplementationOnce(() => new Promise((resolve) => {
      finishSearch = () => resolve([]);
    }));
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({
        prompt: vi.fn().mockResolvedValue(JSON.stringify({ books: [{ title: 'One', author: '' }, { title: 'Two', author: '' }] })),
        destroy: vi.fn(),
      }),
    });
    const user = userEvent.setup();
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Book title and author in natural language'), {
      target: { value: 'One by Author\nTwo by Other author\nListen now\nDownload' },
    });
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    expect(await screen.findByRole('article', { name: 'One by Unknown author' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Two by Unknown author' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Book title and author in natural language')).toHaveValue('');
    expect(screen.queryAllByRole('article')).toHaveLength(2);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.books.map((book: { title: string }) => book.title)).toEqual(['One', 'Two']);
    expect(saved.gallery).toEqual(saved.books.map((book: { id: string }) => book.id));
    expect(saved.books.every((book: { pendingInput?: string }) => book.pendingInput === undefined)).toBe(true);
    expect(openLibraryClient.search).toHaveBeenCalledOnce();
    await act(async () => finishSearch());
    await waitFor(() => expect(openLibraryClient.search).toHaveBeenCalledTimes(2));
  });

  it('shows storage errors and does not replace invalid data until explicit recovery', async () => {
    localStorage.setItem(STORAGE_KEY, 'invalid');
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('not been overwritten');
    await user.type(await screen.findByLabelText('Book title and author in natural language'), 'Temporary book');
    await user.click(screen.getByRole('button', { name: /^\+ Add books?$/ }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('invalid');
    await user.click(screen.getByRole('button', { name: 'Reset saved data and current list' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).books).toEqual([]);
  });

  it('reports autosave failures with a retry action', async () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('Autosave failed');
    write.mockRestore();
    await user.click(screen.getByRole('button', { name: 'Retry saving' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('exports unresolved ranked covers without an informational warning', async () => {
    const board = createBoard();
    board.books = [{ id: 'unresolved', title: 'Unresolved book', author: 'Unknown author' }];
    board.tiers[0].bookIds = ['unresolved'];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    vi.mocked(exportJpeg).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled());
    expect(exportJpeg).toHaveBeenLastCalledWith(expect.any(HTMLDivElement), false);
    expect(screen.queryByText(/Export uses current selections and placeholders/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unresolved cover\(s\)/)).not.toBeInTheDocument();
    expect(screen.getByText('Your tier list JPEG is ready.')).toBeInTheDocument();
  });

  it('shows a busy export state and reports an export failure', async () => {
    let rejectExport: (reason: Error) => void = () => { throw new Error('Export has not started.'); };
    vi.mocked(exportJpeg).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectExport = reject; }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(screen.getByRole('button', { name: 'Creating JPEG...' })).toBeDisabled();
    rejectExport(new Error('Canvas unavailable'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Export failed. Canvas unavailable'));
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
  });

  it('opens settings and edits, recolors, adds, reorders and deletes tiers', async () => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Tier settings/ }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText('Name for tier 1');
    await user.clear(name);
    await user.type(name, 'Favorites');
    await user.tab();
    fireEvent.change(within(dialog).getByLabelText('Color for tier Favorites'), { target: { value: '#aabbcc' } });
    await user.click(within(dialog).getByLabelText('Move tier Favorites down'));
    expect(within(dialog).getByLabelText('Name for tier 2')).toHaveValue('Favorites');
    await user.click(within(dialog).getByRole('button', { name: '+ Add a tier' }));
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(7);
    await user.click(within(dialog).getByLabelText('Delete tier Favorites'));
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(6);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
