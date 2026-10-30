import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Board, BoardChange } from '../board/board';
import type { LookupState } from '../bookResolution/lookupState';
import { useBookResolution } from '../bookResolution/useBookResolution';
import { BookEditor } from './BookEditor';

interface BookContextValue {
  states: Record<string, LookupState>;
  choose: (id: string) => void;
  retry: (id: string) => void;
}
const BookContext = createContext<BookContextValue>({ states: {}, choose: () => undefined, retry: () => undefined });
export const useBooks = () => useContext(BookContext);

export function BookProvider({ board, onChange, children }: {
  board: Board; onChange: BoardChange; children: ReactNode;
}) {
  const resolution = useBookResolution(board, onChange);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = board.books.find((book) => book.id === selectedId);
  return <BookContext.Provider value={{ states: resolution.states, choose: setSelectedId, retry: resolution.retry }}>
    {children}
    {selected && <BookEditor key={selected.id} book={selected} state={resolution.states[selected.id]}
      onSave={(title, author, retry) => resolution.saveBook(selected.id, title, author, retry)}
      onClose={() => setSelectedId(null)}
      onSelect={(selection) => { resolution.selectCover(selected, selection); setSelectedId(null); }} />}
  </BookContext.Provider>;
}
