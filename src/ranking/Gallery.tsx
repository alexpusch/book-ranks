import { useEffect, useRef, useState } from 'react';
import { GALLERY } from '../board/board';
import { BookZone, type BoardProps } from './BookZone';

export function Gallery(props: BoardProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [stuck, setStuck] = useState(false);

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
    <section ref={sectionRef} className="gallery-section" data-stuck={stuck} aria-label="Your books">
      <div className="ranking-hint">
        <span>drag to rank</span>
        <svg viewBox="0 0 80 90" fill="none" aria-hidden="true">
          <path d="M47 8C16 9 10 34 29 43C49 53 62 29 43 27C21 25 21 66 61 76M48 61L63 77L43 81" />
        </svg>
      </div>
      <BookZone {...props} id={GALLERY} bookIds={props.board.gallery} gallery />
    </section>
  );
}
