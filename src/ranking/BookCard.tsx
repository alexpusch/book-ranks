import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Book } from '../board/board';
import { BookContent } from '../books/BookContent';
import { useBooks } from '../books/BookProvider';

interface BookCardProps {
  book: Book;
  location: string;
  onRemove: (id: string) => void;
}

export function BookCard({ book, location, onRemove }: BookCardProps) {
  const { states, choose, retry } = useBooks();
  const state = states[book.id];
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: book.id, data: { kind: 'book', location } });
  return (
    <article
      className={`book-card ${isDragging ? 'is-dragging' : ''}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-book-id={book.id}
      aria-label={book.pendingInput ?? `${book.title} by ${book.author}`}
    >
      <div className="book-content">
        <BookContent book={book} />
      </div>
      <div className="card-actions">
        <button className="book-drag-surface" ref={setActivatorNodeRef} {...attributes} {...listeners}
          aria-label={`Drag ${book.title}`} title="Drag to rank; or press Space, use arrows, then Space to drop">
          <svg viewBox="0 0 24 16" width="24" height="16" fill="currentColor" aria-hidden="true">
            {[5, 12, 19].flatMap((x) => [4, 12].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
          </svg>
        </button>
        <button className="icon-button edit-book" aria-label={`Edit ${book.title}`} onClick={() => choose(book.id)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z" />
          </svg>
        </button>
        <button className="icon-button remove-book" aria-label={`Remove ${book.title}`} onClick={() => onRemove(book.id)}>×</button>
      </div>
      {book.pendingInput !== undefined && state?.outcome !== 'error' ?
        <span className="cover-progress" role="status" aria-label={`Processing book: ${book.title}`}>
          <svg className="chrome-spinner" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 8h9M15.5 14l-4.5 8M8.5 14 4 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span> : (state?.outcome === 'queued' || state?.outcome === 'loading') &&
        <span className="cover-progress" role="status" aria-label={`${state.outcome === 'queued' ? 'Waiting for cover search' : 'Searching for cover'}: ${book.title}`}>
          {state.outcome === 'queued' ? <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" />
          </svg> : <span className="cover-spinner" aria-hidden="true" />}
        </span>}
      <div className="cover-action">
        {!book.coverSelection && state?.outcome === 'needs-review' && <span>Review required</span>}
        {!book.coverSelection && state?.outcome === 'not-found' && <span>No match</span>}
        {book.coverSelection?.kind === 'open-library'}
        {state && 'warning' in state && state.warning && <span>{state.warning}</span>}
        {state?.outcome === 'error' && (book.pendingInput !== undefined
          ? <span role="alert">{state.error} <button type="button" onClick={() => retry(book.id)}>Retry</button> or edit book details.</span>
          : <span>{state.error} Edit book to retry.</span>)}
      </div>
    </article>
  );
}
