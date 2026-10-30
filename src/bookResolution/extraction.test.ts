import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractBooks } from './extraction';
import { type BookLanguageModel } from '../integrations/chromeAi/prompt';

const prompt = vi.fn();
const destroy = vi.fn();
const create = vi.fn<BookLanguageModel['create']>();
const availability = vi.fn<BookLanguageModel['availability']>();

beforeEach(() => {
  prompt.mockReset().mockResolvedValue(JSON.stringify({ books: [{ title: ' Dune ', author: ' Frank   Herbert ' }] }));
  destroy.mockReset();
  create.mockReset().mockResolvedValue({ prompt, destroy });
  availability.mockReset().mockResolvedValue('available');
  vi.stubGlobal('LanguageModel', { availability, create });
});

describe('Chrome book extraction', () => {
  it('sends unstructured text unchanged with sanitation instructions and a structured output schema', async () => {
    const input = 'My list:\n1. The Spear Cuts Through Water: A Novel\nby Simon Jimenez';
    prompt.mockResolvedValueOnce(JSON.stringify({ books: [{ title: 'The Spear Cuts Through Water', author: 'Simon Jimenez' }] }));
    const signal = new AbortController().signal;
    expect(await extractBooks(input, vi.fn(), signal)).toEqual([{ title: 'The Spear Cuts Through Water', author: 'Simon Jimenez' }]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      signal,
      initialPrompts: [{ role: 'system', content: expect.stringContaining('Extract search-ready book titles and author names') }],
    }));
    expect(prompt).toHaveBeenCalledWith(input, {
      signal,
      responseConstraint: expect.objectContaining({ required: ['books'] }),
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('instructs removal of redundant series labels while preserving identifying title wording and volume numbers', async () => {
    const input = 'The Infinite Extent: Bobiverse, Book 6\n2001: A Space Odyssey';
    const books = [
      { title: 'The Infinite Extent', author: '' },
      { title: '2001: A Space Odyssey', author: '' },
    ];
    prompt.mockResolvedValueOnce(JSON.stringify({ books }));
    expect(await extractBooks(input, vi.fn(), new AbortController().signal)).toEqual(books);
    const instructions = create.mock.calls[0][0].initialPrompts[0].content;
    expect(instructions).toContain('Remove appended series labels only when redundant.');
    expect(instructions).toContain('volume identifiers, and title wording needed to distinguish different books.');
    expect(instructions).toContain('Retain subtitle wording when needed to distinguish the intended book.');
    expect(prompt.mock.calls[0][0]).toBe(input);
  });

  it('tidies extracted names and preserves missing authors and title punctuation', async () => {
    expect(await extractBooks('some books', vi.fn(), new AbortController().signal)).toEqual([{ title: 'Dune', author: 'Frank Herbert' }]);
    prompt.mockResolvedValueOnce(JSON.stringify({ books: [{ title: 'Title | Subtitle', author: '' }] }));
    expect(await extractBooks('some books', vi.fn(), new AbortController().signal)).toEqual([{ title: 'Title | Subtitle', author: '' }]);
  });

  it.each(['', ' \n '])('rejects empty input before using the model', async (text) => {
    await expect(extractBooks(text, vi.fn(), new AbortController().signal)).rejects.toThrow('Enter at least one');
    expect(create).not.toHaveBeenCalled();
  });

  it('reports unsupported browsers and unavailable devices without creating a session', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    await expect(extractBooks('Dune', vi.fn(), new AbortController().signal)).rejects.toThrow('up-to-date desktop Chrome');
    vi.stubGlobal('LanguageModel', { availability, create });
    availability.mockResolvedValueOnce('unavailable');
    await expect(extractBooks('Dune', vi.fn(), new AbortController().signal)).rejects.toThrow('unavailable on this device');
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['downloadable', 'downloading'] as const)('reports model download progress for %s', async (state) => {
    availability.mockResolvedValueOnce(state);
    create.mockImplementationOnce(async (options) => {
      options.monitor({ addEventListener: (_type, listener) => listener({ loaded: 0.42 }) });
      return { prompt, destroy };
    });
    const onStatus = vi.fn();
    await extractBooks('Dune', onStatus, new AbortController().signal);
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('first use'));
    expect(onStatus).toHaveBeenCalledWith('Downloading Chrome AI model: 42%');
    expect(onStatus).toHaveBeenLastCalledWith('Extracting and normalizing books with Chrome AI...');
  });

  it.each([
    ['not json', 'invalid JSON'],
    ['{"books":[{"title":"Dune","author":""},{"title":"","author":""}]}', 'invalid book details'],
    ['{"books":[{"title":"Dune","author":null}]}', 'invalid book details'],
    ['{"books":"Dune"}', 'invalid book details'],
    ['null', 'invalid book details'],
    ['{"books":[]}', 'No books could be identified'],
  ])('rejects malformed or empty output %s and releases the session', async (response, message) => {
    prompt.mockResolvedValueOnce(response);
    await expect(extractBooks('some text', vi.fn(), new AbortController().signal)).rejects.toThrow(message);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('propagates creation and inference failures without fallback', async () => {
    create.mockRejectedValueOnce(new Error('Download failed'));
    await expect(extractBooks('Dune', vi.fn(), new AbortController().signal)).rejects.toThrow('Download failed');
    prompt.mockRejectedValueOnce(new Error('Input too large'));
    await expect(extractBooks('Dune', vi.fn(), new AbortController().signal)).rejects.toThrow('Input too large');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('releases the session when cancelled during creation', async () => {
    const controller = new AbortController();
    create.mockImplementationOnce(async () => {
      controller.abort();
      return { prompt, destroy };
    });
    await expect(extractBooks('Dune', vi.fn(), controller.signal)).rejects.toThrow();
    expect(prompt).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
