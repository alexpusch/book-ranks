import type { Board, Book } from '../board/board';
import { BookContent } from '../books/BookContent';

export function ExportBoard({ board }: { board: Board }) {
  const books = new Map<string, Book>(board.books.map((book) => [book.id, book]));
  return (
    <div className="export-board">
      <div className="tier-board">
        {board.tiers.map((tier) => (
          <section key={tier.id} className="tier-row">
            <div className="tier-label" style={{ backgroundColor: tier.color }}>
              <h3>{tier.name}</h3><span>{tier.bookIds.length} {tier.bookIds.length === 1 ? 'book' : 'books'}</span>
            </div>
            <div className="book-zone tier-zone">
              {tier.bookIds.map((id) => <article className="book-card" key={id}><BookContent book={books.get(id)!} /></article>)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
