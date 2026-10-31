import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Board, BoardChange } from '../board/board';
import type { LookupState } from '../bookResolution/lookupState';
import { useBookResolution } from '../bookResolution/useBookResolution';
import { BookEditor } from './BookEditor';
import { BookReview } from './BookReview';

interface BookContextValue {
  states: Record<string, LookupState>;
  choose: (id: string) => void;
  review: (id: string) => void;
  retry: (id: string) => void;
}
const BookContext = createContext<BookContextValue>({ states: {}, choose: () => undefined, review: () => undefined, retry: () => undefined });
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
  return <BookContext.Provider value={{ states: resolution.states, choose: setSelectedId, review: setReviewId, retry: resolution.retry }}>
    {children}
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
