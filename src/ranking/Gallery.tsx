import { useEffect, useRef, useState } from 'react';
import { GALLERY } from '../board/board';
import { BookZone, type BoardProps } from './BookZone';

export function Gallery({ onClear, ...props }: BoardProps & { onClear: () => void }) {
  const sectionRef = useRef<HTMLElement>(null);
  const previousBookIds = useRef(new Set(props.board.books.map((book) => book.id)));
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const addedId = [...props.board.gallery].reverse().find((id) => !previousBookIds.current.has(id));
    previousBookIds.current = new Set(props.board.books.map((book) => book.id));
    if (!addedId) return;
    const zone = sectionRef.current?.querySelector<HTMLElement>('[data-zone="gallery"]');
    const card = Array.from(zone?.querySelectorAll<HTMLElement>('[data-book-id]') ?? [])
      .find((element) => element.dataset.bookId === addedId);
    if (!zone || !card) return;
    const zoneBounds = zone.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    const left = zoneBounds.left + zone.clientLeft;
    const right = left + zone.clientWidth;
    if (cardBounds.right > right) zone.scrollLeft += cardBounds.right - right;
    else if (cardBounds.left < left) zone.scrollLeft += cardBounds.left - left;
  }, [props.board.books, props.board.gallery]);

  useEffect(() => {
    const updateStuck = () => setStuck(sectionRef.current?.getBoundingClientRect().top === 0);
    updateStuck();
    window.addEventListener('scroll', updateStuck, { passive: true });
    window.addEventListener('resize', updateStuck);
    return () => {
      window.removeEventListener('scroll', updateStuck);
      window.removeEventListener('resize', updateStuck);
    };
  }, []);

  return (
    <>
      <div className="gallery-toolbar" role="group" aria-label="Unranked book actions">
        <button className="clear-books-button" type="button" disabled={props.board.gallery.length === 0}
          onClick={onClear}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
          Clear all
        </button>
      </div>
      <section ref={sectionRef} className="gallery-section" data-stuck={stuck} aria-label="Your books">
        <div className="ranking-hint">
          <span>drag to rank</span>
          <svg viewBox="0 0 80 90" fill="none" aria-hidden="true">
            <path d="M47 8C16 9 10 34 29 43C49 53 62 29 43 27C21 25 21 66 61 76M48 61L63 77L43 81" />
          </svg>
        </div>
        <BookZone {...props} id={GALLERY} bookIds={props.board.gallery} gallery />
      </section>
    </>
  );
}
