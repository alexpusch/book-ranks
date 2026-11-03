import { useState } from 'react';
import { addTier, type BoardChange } from '../board/board';
import { BookZone, type BoardProps } from './BookZone';
import { TierTitle } from './TierTitle';

export function RankingBoard({ onChange, ...props }: BoardProps & { onChange: BoardChange }) {
  const [editingId, setEditingId] = useState<string | null>(null);

  function insert(index: number) {
    let id: string | null = null;
    if (
      onChange((board) => {
        const next = addTier(board, index);
        id = next.tiers[index].id;
        return next;
      })
    )
      setEditingId(id);
  }

  return (
    <div className="tier-board" aria-label="Book tier list">
      {props.board.tiers.map((tier, index) => (
        <section key={tier.id} className="tier-row" aria-label={`Tier ${tier.name}`}>
          <button
            type="button"
            className={`tier-insert ${index === 0 ? 'tier-insert-first' : ''}`}
            aria-label={`Insert tier before ${tier.name}`}
            onClick={() => insert(index)}
          >
            <span aria-hidden="true">+</span>
          </button>
          <TierTitle
            tier={tier}
            count={props.board.tiers.length}
            editing={editingId === tier.id}
            onEdit={() => setEditingId(tier.id)}
            onClose={() => setEditingId(null)}
            onChange={onChange}
          />
          <BookZone {...props} id={tier.id} bookIds={tier.bookIds} />
          {index === props.board.tiers.length - 1 && (
            <button
              type="button"
              className="tier-insert tier-insert-last"
              aria-label={`Insert tier after ${tier.name}`}
              onClick={() => insert(index + 1)}
            >
              <span aria-hidden="true">+</span>
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
