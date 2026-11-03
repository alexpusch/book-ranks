import { useEffect, useRef, useState } from 'react';
import { UNKNOWN_AUTHOR, tidy, type Book } from '../board/board';
import { openLibraryClient } from '../integrations/openLibrary/client';
import type { LookupInput, WorkCandidate } from '../integrations/openLibrary/types';
import { CoverImage } from './CoverImage';

export function BookReview({
  book,
  works: initialWorks,
  nextCursor: initialCursor,
  onSelect,
  onClose,
}: {
  book: Book;
  works: WorkCandidate[];
  nextCursor: string | null;
  onSelect: (work: WorkCandidate) => string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const backdropPress = useRef(false);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author === UNKNOWN_AUTHOR ? '' : book.author);
  const [works, setWorks] = useState(initialWorks);
  const [query, setQuery] = useState<LookupInput>({
    title: book.title,
    author: book.author === UNKNOWN_AUTHOR ? undefined : book.author,
  });
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      request.current?.abort();
      element.close();
    };
  }, []);

  async function search(more = false) {
    if (more && (busy || nextCursor === null)) return;
    if (!more && !tidy(title)) {
      setError('Book titles cannot be empty.');
      return;
    }
    const input = more ? query : { title: tidy(title), author: tidy(author) || undefined };
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setLoadingMore(more);
    setError('');
    if (!more) {
      setWorks([]);
      setNextCursor(null);
      setQuery(input);
    }
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]);
      const results = await openLibraryClient.searchPage(
        {
          ...input,
          ...(more && nextCursor !== null ? { cursor: nextCursor } : {}),
        },
        signal,
      );
      signal.throwIfAborted();
      if (!controller.signal.aborted && request.current === controller) {
        setWorks((previous) => {
          const known = new Set<string>();
          return (more ? [...previous, ...results.works] : results.works).filter((work) => {
            if (known.has(work.id)) return false;
            known.add(work.id);
            return true;
          });
        });
        setNextCursor(results.nextCursor);
      }
    } catch (error) {
      if (!controller.signal.aborted && request.current === controller) {
        setError(error instanceof Error ? error.message : 'Book search failed. Please try again.');
      }
    } finally {
      if (!controller.signal.aborted && request.current === controller) {
        setBusy(false);
        setLoadingMore(false);
      }
    }
  }

  function outsidePanel(x: number, y: number) {
    const bounds = dialog.current!.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  }

  return (
    <dialog
      className="settings-drawer cover-chooser book-editor book-review"
      ref={dialog}
      aria-label="Review book matches"
      onCancel={onClose}
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget && outsidePanel(event.clientX, event.clientY);
      }}
      onClick={(event) => {
        if (backdropPress.current && event.target === event.currentTarget && outsidePanel(event.clientX, event.clientY))
          onClose();
        backdropPress.current = false;
      }}
    >
      <button className="icon-button book-editor-close" aria-label="Close book review" onClick={onClose}>
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
      <form
        className="book-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <input
          className="book-name-input"
          aria-label="Book title"
          placeholder="Book title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
        <input
          className="book-author-input"
          aria-label="Author"
          placeholder="Author name"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
        />
        <button className="primary-button" type="submit">
          Search
        </button>
      </form>
      <h3 className="cover-section-title">Choose a book</h3>
      {busy && <p role="status">{loadingMore ? 'Loading more matches...' : 'Searching Open Library...'}</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!busy && !error && !works.length && (
        <p role="status">No matching works found. Refine your search and try again.</p>
      )}
      <div className="cover-options work-options" role="group" aria-label="Book match gallery" aria-busy={busy}>
        {works.map((work) => (
          <div className="work-option" key={work.id}>
            <CoverImage
              title={work.title}
              selection={work.covers[0] ? { kind: 'open-library', workId: work.id, ...work.covers[0] } : undefined}
            />
            <button
              type="button"
              className="work-choice"
              aria-label={`Select ${work.title} by ${work.authors.join(', ') || UNKNOWN_AUTHOR}`}
              onClick={() => setError(onSelect(work) ?? '')}
            >
              <span className="book-title">{work.title}</span>
              <span className="book-author">{work.authors.join(', ') || UNKNOWN_AUTHOR}</span>
            </button>
          </div>
        ))}
      </div>
      {nextCursor !== null && (
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void search(true)}>
          {loadingMore ? 'Loading more...' : 'Show more'}
        </button>
      )}
      {!busy && !error && nextCursor === null && works.length > 0 && <p role="status">All matching works loaded.</p>}
      <p className="cover-attribution">
        <a href="https://openlibrary.org" target="_blank" rel="noreferrer">
          Metadata and covers from Open Library
        </a>
      </p>
    </dialog>
  );
}
