import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import type { Board } from '../board/board';
import { BookCard } from './BookCard';

export interface BoardProps {
  board: Board;
  onRemove: (id: string) => void;
}

export function BookZone({ id, bookIds, board, onRemove, gallery = false }: BoardProps & {
  id: string;
  bookIds: string[];
  gallery?: boolean;
}) {
  const { setNodeRef, isOver, over } = useDroppable({ id });
  const highlighted = isOver || bookIds.some((bookId) => bookId === over?.id);
  const books = new Map(board.books.map((book) => [book.id, book]));
  return (
    <div ref={setNodeRef} className={`book-zone ${gallery ? 'gallery-zone' : 'tier-zone'} ${highlighted ? 'drop-over' : ''}`}
      data-zone={id}>
      <SortableContext items={bookIds} strategy={gallery ? horizontalListSortingStrategy : rectSortingStrategy}>
        {bookIds.map((bookId) => (
          <BookCard key={bookId} book={books.get(bookId)!} location={id}
            onRemove={onRemove} />
        ))}
      </SortableContext>
      {!bookIds.length && <p className="zone-hint">{gallery ? 'your books' : 'Drop a book here'}</p>}
    </div>
  );
}
