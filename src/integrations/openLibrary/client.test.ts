import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createOpenLibraryClient } from './client';

const response = (data: unknown) => new Response(JSON.stringify(data));
const doc = { key: '/works/OL1W', title: 'Dune', author_name: ['Frank Herbert'], cover_i: 123 };
const signal = () => new AbortController().signal;
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.useFakeTimers();
  fetcher.mockReset().mockImplementation(async () => response({ docs: [doc] }));
});
afterEach(() => vi.useRealTimers());

it('uses direct bounded searches with minimal fields and no browser-forbidden contact header', async () => {
  const client = createOpenLibraryClient({ fetch: fetcher });
  const result = client.search({ title: ' Dune ', author: 'Unknown author' }, signal());
  await vi.runAllTimersAsync();
  expect(await result).toEqual([{
    id: 'OL1W', title: 'Dune', authors: ['Frank Herbert'], covers: [{ coverId: 123 }], editions: [], nextCursor: '0',
  }]);
  const [url, options] = fetcher.mock.calls[0];
  expect(String(url)).toContain('https://openlibrary.org/search.json?');
  expect(new URL(String(url)).searchParams.get('title')).toBe('Dune');
  expect(new URL(String(url)).searchParams.has('author')).toBe(false);
  expect(new URL(String(url)).searchParams.get('limit')).toBe('10');
  expect(options?.headers).toEqual({ Accept: 'application/json' });
  expect(options?.credentials).toBe('omit');
});

it('finds Children of Ruin by title despite an edition identifier in the search results', async () => {
  fetcher.mockResolvedValueOnce(response({
    docs: [
      { key: '/works/OL20079532W', title: 'Children of Ruin', author_name: ['Adrian Tchaikovsky'], cover_i: 8750923 },
      { key: '/works/OL24214005W', title: 'Children Of Ruin', cover_i: 10668508 },
      { key: '/works/OL16367778M', title: 'The unanswered prayer, or, Why do so many children of the church go to ruin?' },
    ],
  }));
  const task = createOpenLibraryClient({ fetch: fetcher }).search({ title: 'Children of Ruin' }, signal());
  const result = expect(task).resolves.toEqual([
    { id: 'OL20079532W', title: 'Children of Ruin', authors: ['Adrian Tchaikovsky'],
      covers: [{ coverId: 8750923 }], editions: [], nextCursor: '0' },
    { id: 'OL24214005W', title: 'Children Of Ruin', authors: [],
      covers: [{ coverId: 10668508 }], editions: [], nextCursor: '0' },
  ]);
  await Promise.all([result, vi.runAllTimersAsync()]);
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.has('author')).toBe(false);
});

it('returns no work candidates when search only contains legacy edition records', async () => {
  fetcher.mockResolvedValueOnce(response({
    docs: [{ key: '/works/OL16367778M', title: 'The unanswered prayer' }],
  }));
  const task = createOpenLibraryClient({ fetch: fetcher }).search({ title: 'The unanswered prayer' }, signal());
  await Promise.all([expect(task).resolves.toEqual([]), vi.runAllTimersAsync()]);
});

it('paces search and edition requests through the same one-second queue', async () => {
  const starts: number[] = [];
  fetcher.mockImplementation(async (url) => {
    starts.push(Date.now());
    return String(url).includes('editions.json')
      ? response({ entries: [], size: 0 }) : response({ docs: [] });
  });
  const client = createOpenLibraryClient({ fetch: fetcher });
  const tasks = [
    client.search({ title: 'First', author: 'Author' }, signal()),
    client.editions({ workId: 'OL1W' }, signal()),
    client.search({ title: 'Third' }, signal()),
  ];
  await vi.runAllTimersAsync();
  await Promise.all(tasks);
  expect(starts.map((time) => time - starts[0])).toEqual([0, 1000, 2000]);
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('author')).toBe('Author');
});

it('never overlaps in-flight requests even when the first takes longer than a second', async () => {
  let release!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
    .mockResolvedValueOnce(response({ docs: [] }));
  const client = createOpenLibraryClient({ fetch: fetcher });
  const first = client.search({ title: 'First' }, signal());
  const second = client.search({ title: 'Second' }, signal());
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetcher).toHaveBeenCalledOnce();
  release(response({ docs: [] }));
  await first;
  await vi.runAllTimersAsync();
  await second;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('honors Retry-After and recovers without exceeding three attempts', async () => {
  const starts: number[] = [];
  fetcher.mockImplementation(async () => {
    starts.push(Date.now());
    return starts.length < 3 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : response({ docs: [] });
  });
  const task = createOpenLibraryClient({ fetch: fetcher }).search({ title: 'Dune' }, signal());
  await vi.runAllTimersAsync();
  expect(await task).toEqual([]);
  expect(starts.map((time) => time - starts[0])).toEqual([0, 2000, 4000]);
});

it('reports excessive throttling explicitly and keeps the next request throttled', async () => {
  fetcher.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '60' } }));
  const client = createOpenLibraryClient({ fetch: fetcher });
  const failure = expect(client.search({ title: 'Dune' }, signal())).rejects.toThrow('unavailable (429)');
  await vi.runAllTimersAsync();
  await failure;
  await expect(client.search({ title: 'Next' }, signal())).rejects.toThrow('throttling');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('skips cancelled queued requests and continues after them', async () => {
  const client = createOpenLibraryClient({ fetch: fetcher });
  const controller = new AbortController();
  const first = client.search({ title: 'First' }, signal());
  const cancelled = expect(client.search({ title: 'Cancelled' }, controller.signal)).rejects.toThrow();
  controller.abort();
  const third = client.search({ title: 'Third' }, signal());
  await vi.runAllTimersAsync();
  await Promise.all([first, cancelled, third]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('validates edition metadata and pagination without automatically following it', async () => {
  fetcher.mockResolvedValueOnce(response({
    entries: [{ key: '/books/OL1M', title: 'Dune', covers: [-1, 456, 456], publish_date: '2025',
      languages: [{ key: '/languages/eng' }], publishers: ['Publisher'], isbn_13: ['9780000000000'] }],
    size: 40, links: { next: '/works/OL1W/editions.json?offset=20&limit=20' },
  }));
  const task = createOpenLibraryClient({ fetch: fetcher }).editions({ workId: 'OL1W' }, signal());
  await vi.runAllTimersAsync();
  expect(await task).toEqual({
    editions: [{ id: 'OL1M', title: 'Dune', covers: [{ coverId: 456, editionId: 'OL1M' }],
      publicationDate: '2025', languages: ['eng'], publishers: ['Publisher'], isbns: ['9780000000000'] }],
    nextCursor: '20',
  });
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([
  { docs: [{ ...doc, key: '/works/invalid' }] },
  { docs: [{ ...doc, title: '' }] },
  { docs: [{ ...doc, author_name: 'Author' }] },
  { docs: Array(11).fill(doc) },
  { docs: 'invalid' },
])('rejects malformed search metadata rather than pretending there is no match', async (data) => {
  fetcher.mockResolvedValueOnce(response(data));
  const failure = expect(createOpenLibraryClient({ fetch: fetcher }).search({ title: 'Dune' }, signal())).rejects.toThrow();
  await vi.runAllTimersAsync();
  await failure;
});

it('rejects malformed JSON and unsafe edition cursors', async () => {
  const client = createOpenLibraryClient({ fetch: fetcher });
  fetcher.mockResolvedValueOnce(new Response('not json'));
  const failure = expect(client.search({ title: 'Dune' }, signal())).rejects.toThrow('malformed JSON');
  await vi.runAllTimersAsync();
  await failure;
  await expect(client.editions({ workId: 'https://evil.invalid' }, signal())).rejects.toThrow('Invalid work');
  await expect(client.editions({ workId: 'OL1W', cursor: '-1' }, signal())).rejects.toThrow('Invalid work');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('bounds queue capacity and recovers after network failures exhaust three attempts', async () => {
  fetcher.mockRejectedValueOnce(new Error('Offline'))
    .mockRejectedValueOnce(new Error('Offline'))
    .mockRejectedValueOnce(new Error('Offline'));
  const client = createOpenLibraryClient({ fetch: fetcher, queueLimit: 1 });
  const failure = expect(client.search({ title: 'Dune' }, signal())).rejects.toThrow('Offline');
  await expect(client.search({ title: 'Excess' }, signal())).rejects.toThrow('queue is full');
  await vi.runAllTimersAsync();
  await failure;
  expect(fetcher).toHaveBeenCalledTimes(3);
  const next = client.search({ title: 'Next' }, signal());
  await vi.runAllTimersAsync();
  expect(await next).toHaveLength(1);
});

it('rejects cross-origin or non-advancing edition pagination', async () => {
  const client = createOpenLibraryClient({ fetch: fetcher });
  for (const next of ['https://evil.invalid/works/OL1W/editions.json?offset=20', '/works/OL1W/editions.json?offset=0']) {
    fetcher.mockResolvedValueOnce(response({ entries: [], size: 40, links: { next } }));
    const failure = expect(client.editions({ workId: 'OL1W' }, signal())).rejects.toThrow('Invalid edition pagination');
    await vi.runAllTimersAsync();
    await failure;
  }
});
