import { useEffect, useRef, useState } from 'react';
import { UNKNOWN_AUTHOR, importBooks, resolveQueuedBooks, updateBook, type Board, type BoardChange, type Book, type BookInput } from '../board/board';
import type { CoverSelection } from '../board/coverSelection';
import { openLibraryClient } from '../integrations/openLibrary/client';
import { normalize, type WorkCandidate } from '../integrations/openLibrary/types';
import { matchBook } from './matching';
import { extractBooks } from './extraction';
import { lookupIdentity, type LookupState } from './lookupState';

interface LookupItem {
  book: Book; identity: string; controller: AbortController; manualEntry: boolean;
}

export function useBookResolution(board: Board, onChange: BoardChange) {
  const [states, setStates] = useState<Record<string, LookupState>>({});
  const statesRef = useRef(states);
  const boardRef = useRef(board);
  boardRef.current = board;
  const requests = useRef(new Map<string, LookupItem>());
  const identities = useRef(new Map<string, string>());
  const queue = useRef<LookupItem[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const item of requests.current.values()) item.controller.abort();
      requests.current.clear();
      queue.current = [];
      statesRef.current = {};
    };
  }, []);

  function publish(key: string, state: LookupState) {
    statesRef.current = { ...statesRef.current, [key]: state };
    setStates(statesRef.current);
  }
  async function drain() {
    if (running.current) return;
    running.current = true;
    try {
      while (alive.current && queue.current.length) {
        const item = queue.current.shift()!;
        const id = item.book.id;
        if (requests.current.get(id) !== item) continue;
        const isCurrent = (book: Book) => book.id === id && lookupIdentity(book) === item.identity;
        if (!boardRef.current.books.some(isCurrent)) {
          requests.current.delete(id);
          continue;
        }
        publish(id, { outcome: item.book.pendingInput !== undefined ? 'extracting' : 'loading' });
        try {
          const manualEntry = item.manualEntry;
          if (item.book.pendingInput !== undefined) {
            const entries = await extractBooks(item.book.pendingInput, () => {}, item.controller.signal);
            item.controller.signal.throwIfAborted();
            if (!alive.current) return;
            if (requests.current.get(id) !== item || !boardRef.current.books.some(isCurrent)) continue;
            const existingIds = new Set(boardRef.current.books.map((book) => book.id));
            const next = resolveQueuedBooks(boardRef.current, id, entries);
            if (!onChange(() => next)) throw new Error('Could not save the book details.');
            boardRef.current = next;
            item.book = next.books.find((book) => book.id === id)!;
            item.identity = lookupIdentity(item.book);
            identities.current.set(id, item.identity);
            lookup(next.books.filter((book) => !existingIds.has(book.id)), false);
            if (item.book.coverSelection) {
              publish(id, { outcome: 'matched', works: [] });
              continue;
            }
            publish(id, { outcome: 'loading' });
          }
          const signal = AbortSignal.any([item.controller.signal, AbortSignal.timeout(180_000)]);
          const { works, nextCursor } = await openLibraryClient.searchPage(item.book, signal);
          signal.throwIfAborted();
          const exactMatch = manualEntry && item.book.author !== UNKNOWN_AUTHOR
            ? works.find((work) => normalize(work.title) === normalize(item.book.title)
              && normalize(work.authors.join(', ')) === normalize(item.book.author))
            : undefined;
          if (manualEntry && works.length > 1 && !exactMatch) {
            if (alive.current && requests.current.get(id) === item && boardRef.current.books.some(isCurrent)) {
              publish(id, { outcome: 'needs-review', works, nextSearchCursor: nextCursor });
            }
            continue;
          }
          const match = exactMatch ?? await matchBook({
            title: item.book.title, author: item.book.author === UNKNOWN_AUTHOR ? '' : item.book.author,
          }, works, signal);
          signal.throwIfAborted();
          if (!alive.current) return;
          if (requests.current.get(id) !== item || !boardRef.current.books.some(isCurrent)) continue;
          if (!match) {
            publish(id, { outcome: works.length ? 'needs-review' : 'not-found', works, nextSearchCursor: nextCursor });
            continue;
          }
          const selection: CoverSelection | undefined = match.covers.length
            ? { kind: 'open-library', workId: match.id, ...match.covers[0] } : undefined;
          let next = updateBook(boardRef.current, id, { title: match.title, author: match.authors.join(', ') });
          next = { ...next, books: next.books.map((book) => book.id === id
            ? { ...book, matchedWorkId: match.id, coverSelection: book.coverSelection ?? selection } : book) };
          if (!onChange(() => next)) throw new Error('Could not save the matched book.');
          boardRef.current = next;
          identities.current.set(id, lookupIdentity(next.books.find((book) => book.id === id)!));
          publish(id, { outcome: selection ? 'matched' : 'needs-review', works: [match], selection });
        } catch (error) {
          if (alive.current && requests.current.get(id) === item && boardRef.current.books.some(isCurrent)) {
            publish(id, { outcome: 'error', works: [],
              error: error instanceof Error ? error.message : 'Cover lookup failed.' });
          }
        } finally {
          if (requests.current.get(id) === item) requests.current.delete(id);
        }
      }
    } finally {
      running.current = false;
    }
  }
  function lookup(books: Book[], manualEntry = true) {
    for (const book of books) {
      if (requests.current.has(book.id)) continue;
      const identity = lookupIdentity(book);
      const item = { book, identity, controller: new AbortController(),
        manualEntry: manualEntry && book.pendingInput === undefined };
      requests.current.set(book.id, item);
      identities.current.set(book.id, identity);
      queue.current.push(item);
      publish(book.id, { outcome: 'queued' });
    }
    void drain();
  }
  useEffect(() => {
    for (const [id, identity] of identities.current) {
      const book = board.books.find((book) => book.id === id);
      if (book && lookupIdentity(book) === identity) continue;
      requests.current.get(id)?.controller.abort();
      requests.current.delete(id);
      identities.current.delete(id);
      const next = { ...statesRef.current };
      delete next[id]; statesRef.current = next; setStates(next);
    }
    lookup(board.books.filter((book) => (book.pendingInput !== undefined || (!book.coverSelection && !book.matchedWorkId)) && !statesRef.current[book.id]));
  }, [board.books]);

  function retry(id: string) {
    const book = boardRef.current.books.find((book) => book.id === id);
    if (book && statesRef.current[id]?.outcome === 'error') lookup([book]);
  }
  function addAiBooks(entries: BookInput[]): boolean {
    let next = boardRef.current;
    let added: Book[] = [];
    if (!onChange((current) => {
      next = importBooks(current, entries);
      added = next.books.slice(current.books.length);
      return next;
    })) return false;
    boardRef.current = next;
    lookup(added, false);
    return true;
  }
  function saveBook(id: string, title: string, author: string, retry: boolean): string | null {
    const selected = boardRef.current.books.find((book) => book.id === id);
    if (!selected) return 'Book not found.';
    try {
      const next = updateBook(boardRef.current, id, { title, author });
      const updated = next.books.find((book) => book.id === id)!;
      if (lookupIdentity(updated) !== lookupIdentity(selected) || retry) updated.matchedWorkId = undefined;
      if (retry) updated.coverSelection = undefined;
      if (!onChange(() => next)) return 'Could not save book changes. Please try again.';
      boardRef.current = next;
      if (retry || lookupIdentity(updated) !== lookupIdentity(selected)) {
        requests.current.get(id)?.controller.abort();
        requests.current.delete(id);
        identities.current.set(id, lookupIdentity(updated));
        const nextStates = { ...statesRef.current };
        delete nextStates[id]; statesRef.current = nextStates; setStates(nextStates);
        if (retry || !updated.coverSelection) lookup([updated]);
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not save book changes.';
    }
  }
  function selectCover(selected: Book, selection: CoverSelection) {
    if (selected.pendingInput === undefined) {
      requests.current.get(selected.id)?.controller.abort();
      requests.current.delete(selected.id);
      const state = statesRef.current[selected.id];
      publish(selected.id, { outcome: 'matched', works: state && 'works' in state ? state.works : [] });
    }
    onChange((current) => ({ ...current, books: current.books.map((book) =>
      book.id === selected.id ? { ...book, coverSelection: selection } : book) }));
  }
  function selectWork(id: string, work: WorkCandidate): string | null {
    try {
      let next = updateBook(boardRef.current, id, { title: work.title, author: work.authors.join(', ') });
      const cover = work.covers[0];
      const selection: CoverSelection | undefined = cover
        ? { kind: 'open-library', workId: work.id, ...cover } : undefined;
      next = { ...next, books: next.books.map((book) => book.id === id
        ? { ...book, matchedWorkId: work.id, coverSelection: book.coverSelection ?? selection } : book) };
      if (!onChange(() => next)) return 'Could not save the matched book. Please try again.';
      boardRef.current = next;
      requests.current.get(id)?.controller.abort();
      requests.current.delete(id);
      identities.current.set(id, lookupIdentity(next.books.find((book) => book.id === id)!));
      publish(id, { outcome: 'matched', works: [work], selection });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not save the matched book.';
    }
  }
  return { states, retry, addAiBooks, saveBook, selectCover, selectWork };
}
