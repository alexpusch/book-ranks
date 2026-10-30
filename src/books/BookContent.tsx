import type { Book } from '../board/board';
import { CoverImage } from './CoverImage';

export function BookContent({ book }: { book: Book }) {
  return (
    <>
      <CoverImage selection={book.coverSelection} title={book.title} />
      <div className={`book-title${book.pendingInput !== undefined ? ' pending-book-text' : ''}`}>{book.pendingInput ?? book.title}</div>
      {book.pendingInput === undefined && <div className="book-author">{book.author}</div>}
    </>
  );
}
