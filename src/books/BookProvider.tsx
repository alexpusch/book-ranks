import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Board, BoardChange, BookInput } from '../board/board';
import type { LookupState } from '../bookResolution/lookupState';
import { useBookResolution } from '../bookResolution/useBookResolution';
import { BookEditor } from './BookEditor';
import { BookReview } from './BookReview';
import { useLocalCover } from './useLocalCover';

interface BookContextValue {
  states: Record<string, LookupState>;
  choose: (id: string) => void;
  review: (id: string) => void;
  retry: (id: string) => void;
  addAiBooks: (entries: BookInput[]) => boolean;
  hover: (element: HTMLElement | null) => void;
}
const BookContext = createContext<BookContextValue>({ states: {}, choose: () => undefined, review: () => undefined, retry: () => undefined,
  hover: () => undefined,
  addAiBooks: () => { throw new Error('Book entry is not ready. Please try again.'); } });
export const useBooks = () => useContext(BookContext);

export function BookProvider({ board, onChange, children }: {
  board: Board; onChange: BoardChange; children: ReactNode;
}) {
  const resolution = useBookResolution(board, onChange);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const selected = board.books.find((book) => book.id === selectedId);
  const reviewed = board.books.find((book) => book.id === reviewId);
  const reviewState = reviewed && resolution.states[reviewed.id];
  const hoveredCard = useRef<HTMLElement | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
  const { selectImage, imageBusy, imageError } = useLocalCover();
  useEffect(() => {
    function paste(event: ClipboardEvent) {
      const card = hoveredCard.current;
      const editable = (element: EventTarget | null) => element instanceof HTMLElement &&
        (element.isContentEditable || element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
      if (!card?.isConnected || event.defaultPrevented || document.querySelector('dialog[open], .book-card.is-dragging') ||
        editable(event.target) || editable(document.activeElement)) return;
      const book = boardRef.current.books.find((book) => book.id === card.dataset.bookId);
      const file = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'));
      if (!book || !file) return;
      event.preventDefault();
      void selectImage(file, (selection) => {
        const current = boardRef.current.books.find((current) => current.id === book.id);
        if (current) resolution.selectCover(current, selection);
      });
    }
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [resolution.selectCover, selectImage]);
  return <BookContext.Provider value={{ states: resolution.states, choose: setSelectedId, review: setReviewId,
    retry: resolution.retry, addAiBooks: resolution.addAiBooks, hover: (element) => { hoveredCard.current = element; } }}>
    {children}
    {imageBusy && <p role="status">Preparing cover image...</p>}
    {imageError && <p className="field-error" role="alert">{imageError}</p>}
    {reviewed && <BookReview key={reviewed.id} book={reviewed}
      works={reviewState && 'works' in reviewState ? reviewState.works : []}
      nextCursor={reviewState && 'nextSearchCursor' in reviewState ? reviewState.nextSearchCursor ?? null : null}
      onClose={() => setReviewId(null)}
      onSelect={(work) => {
        const error = resolution.selectWork(reviewed.id, work);
        if (!error) setReviewId(null);
        return error;
      }} />}
    {selected && <BookEditor key={selected.id} book={selected} state={resolution.states[selected.id]}
      onSave={(title, author) => resolution.saveBook(selected.id, title, author, false)}
      onClose={() => setSelectedId(null)}
      onSelect={(selection) => { resolution.selectCover(selected, selection); setSelectedId(null); }} />}
  </BookContext.Provider>;
}
