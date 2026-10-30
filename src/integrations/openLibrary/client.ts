import { editionPattern, normalize, workPattern, type EditionCandidate, type EditionInput, type EditionPage, type LookupInput, type WorkCandidate } from './types';

const SEARCH_LIMIT = 10;
const EDITION_PAGE_SIZE = 20;
const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 30_000;

export interface OpenLibraryClient {
  search(input: LookupInput, signal: AbortSignal): Promise<WorkCandidate[]>;
  editions(input: EditionInput, signal: AbortSignal): Promise<EditionPage>;
}

export interface OpenLibraryClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  intervalMs?: number;
  timeoutMs?: number;
  queueLimit?: number;
}

class UpstreamResponseError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Malformed Open Library response.');
  }
  return value as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('Malformed Open Library metadata.');
  }
  return value;
}

function coverIds(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((id) => Number.isSafeInteger(id))) {
    throw new Error('Malformed cover identifiers.');
  }
  return [...new Set(value.filter((id): id is number => typeof id === 'number' && id > 0))];
}

function identifier(value: unknown, pattern: RegExp, prefix: string): string {
  if (typeof value !== 'string') throw new Error('Missing Open Library identifier.');
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (!pattern.test(id)) throw new Error('Invalid Open Library identifier.');
  return id;
}

function parseWork(value: unknown): WorkCandidate | null {
  const work = record(value);
  // Search can include legacy edition IDs under /works/; they are not work candidates.
  if (typeof work.key === 'string' && editionPattern.test(work.key.replace(/^\/works\//u, ''))) return null;
  const id = identifier(work.key, workPattern, '/works/');
  if (typeof work.title !== 'string' || !work.title.trim()) throw new Error('Missing work title.');
  return {
    id,
    title: work.title,
    authors: strings(work.author_name),
    covers: coverIds(work.cover_i === undefined ? undefined : [work.cover_i]).map((coverId) => ({ coverId })),
    editions: [],
    nextCursor: '0',
  };
}

function parseLanguages(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Invalid languages.');
  return value.map((language) => {
    const key = record(language).key;
    if (typeof key !== 'string' || !/^\/languages\/[a-z]{3}$/u.test(key)) {
      throw new Error('Invalid language.');
    }
    return key.slice(11);
  });
}

function parseEdition(value: unknown): EditionCandidate {
  const edition = record(value);
  const id = identifier(edition.key, editionPattern, '/books/');
  if (typeof edition.title !== 'string' || !edition.title.trim()) throw new Error('Missing edition title.');
  if (edition.publish_date !== undefined && typeof edition.publish_date !== 'string') {
    throw new Error('Invalid publication date.');
  }
  return {
    id,
    title: edition.title,
    languages: parseLanguages(edition.languages),
    publishers: strings(edition.publishers),
    ...(typeof edition.publish_date === 'string' ? { publicationDate: edition.publish_date } : {}),
    isbns: [...strings(edition.isbn_10), ...strings(edition.isbn_13)],
    covers: coverIds(edition.covers).map((coverId) => ({ coverId, editionId: id })),
  };
}

function parseNextCursor(links: unknown, url: URL, cursor: string): string | null {
  if (links === undefined) return null;
  const next = record(links).next;
  if (next === undefined) return null;
  if (typeof next !== 'string') throw new Error('Invalid edition pagination.');
  const nextUrl = new URL(next, 'https://openlibrary.org');
  const offset = nextUrl.searchParams.get('offset');
  if (nextUrl.origin !== 'https://openlibrary.org' || nextUrl.pathname !== url.pathname ||
    !offset || !/^[1-9]\d{0,5}$/u.test(offset) || Number(offset) <= Number(cursor)) {
    throw new Error('Invalid edition pagination.');
  }
  return offset;
}

function retryDelay(retryAfter: string | null, attempt: number, now: number): number {
  if (!retryAfter) return 1000 * 2 ** attempt;
  const delay = /^\d+$/u.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 1000;
}

export function createOpenLibraryClient(options: OpenLibraryClientOptions = {}): OpenLibraryClient {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const interval = options.intervalMs ?? 1000;
  const timeout = options.timeoutMs ?? 10_000;
  const queueLimit = options.queueLimit ?? 100;
  let tail = Promise.resolve();
  let pending = 0;
  let nextRequest = 0;

  async function waitForRequestSlot(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const delay = Math.max(0, nextRequest - now());
    if (delay > MAX_BACKOFF_MS) throw new Error('Open Library is throttling requests; retry later.');
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
      signal.addEventListener('abort', abort, { once: true });
    });
    signal.throwIfAborted();
    nextRequest = now() + interval;
  }

  async function fetchWithRetries(url: URL, signal: AbortSignal): Promise<unknown> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await waitForRequestSlot(signal);
      try {
        const response = await fetcher(url, {
          headers: { Accept: 'application/json' },
          credentials: 'omit',
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
        });
        if (response.status === 429 || response.status >= 500) {
          const delay = retryDelay(response.headers.get('retry-after'), attempt, now());
          nextRequest = Math.max(nextRequest, now() + delay);
          if (delay > MAX_BACKOFF_MS || attempt === MAX_ATTEMPTS - 1) {
            throw new UpstreamResponseError(`Open Library unavailable (${response.status}); retry later.`);
          }
          continue;
        }
        if (!response.ok) throw new UpstreamResponseError(`Open Library request failed (${response.status}).`);
        try {
          return await response.json();
        } catch (cause) {
          throw new UpstreamResponseError('Open Library returned malformed JSON.', { cause });
        }
      } catch (error) {
        signal.throwIfAborted();
        if (attempt === MAX_ATTEMPTS - 1 || error instanceof UpstreamResponseError) throw error;
        nextRequest = Math.max(nextRequest, now() + 1000 * 2 ** attempt);
      }
    }
    throw new Error('Open Library unavailable.');
  }

  async function request(url: URL, signal: AbortSignal): Promise<unknown> {
    if (pending >= queueLimit) throw new Error('Cover lookup queue is full. Please retry later.');
    pending++;
    const task = tail.then(() => fetchWithRetries(url, signal));
    tail = task.then(() => undefined, () => undefined);
    try {
      return await task;
    } finally {
      pending--;
    }
  }

  async function search(input: LookupInput, signal: AbortSignal): Promise<WorkCandidate[]> {
    if (!input.title.trim() || input.title.length > 500 || (input.author?.length ?? 0) > 300) {
      throw new Error('Search requires a title up to 500 characters and an author up to 300 characters.');
    }
    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('title', input.title.trim());
    const author = input.author?.trim();
    if (author && normalize(author) !== 'unknown author') url.searchParams.set('author', author);
    url.searchParams.set('fields', 'key,title,author_name,cover_i');
    url.searchParams.set('limit', String(SEARCH_LIMIT));
    const data = record(await request(url, signal));
    if (!Array.isArray(data.docs) || data.docs.length > SEARCH_LIMIT) throw new Error('Malformed search results.');
    return data.docs.map(parseWork).filter((work) => work !== null);
  }

  async function editions({ workId, cursor = '0' }: EditionInput, signal: AbortSignal): Promise<EditionPage> {
    if (!workPattern.test(workId) || !/^(0|[1-9]\d{0,5})$/u.test(cursor)) {
      throw new Error('Invalid work or edition cursor.');
    }
    const url = new URL(`https://openlibrary.org/works/${workId}/editions.json`);
    url.searchParams.set('limit', String(EDITION_PAGE_SIZE));
    url.searchParams.set('offset', cursor);
    const data = record(await request(url, signal));
    if (!Array.isArray(data.entries) || data.entries.length > EDITION_PAGE_SIZE ||
      !Number.isSafeInteger(data.size) || Number(data.size) < 0) {
      throw new Error('Malformed edition page.');
    }
    return {
      editions: data.entries.map(parseEdition),
      nextCursor: parseNextCursor(data.links, url, cursor),
    };
  }

  return { search, editions };
}

export const openLibraryClient = createOpenLibraryClient();
