import type { Book } from '../board/board';
import { CoverImage } from './CoverImage';

export function BookContent({ book, multipleMatches = false }: { book: Book; multipleMatches?: boolean }) {
  return (
    <>
      {multipleMatches ? (
        <div className="book-cover multiple-matches-cover">
          <svg
            viewBox="0 0 24 24"
            width="54"
            height="54"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="M7 7a5 5 0 0 1 10 0c0 4-5 4-5 8" strokeLinecap="round" />
            <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
          </svg>
          <span className="multiple-matches">Multiple matches</span>
        </div>
      ) : (
        <CoverImage selection={book.coverSelection} title={book.title} />
      )}
      <div className={`book-title${book.pendingInput !== undefined ? ' pending-book-text' : ''}`}>
        {book.pendingInput ?? book.title}
      </div>
      {book.pendingInput === undefined && <div className="book-author">{book.author}</div>}
    </>
  );
}
