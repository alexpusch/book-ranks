import { BookZone, type BoardProps } from './BookZone';

export function RankingBoard(props: BoardProps) {
  return (
    <div className="tier-board" aria-label="Book tier list">
      {props.board.tiers.map((tier) => (
        <section key={tier.id} className="tier-row" aria-label={`Tier ${tier.name}`}>
          <div className="tier-label" style={{ backgroundColor: tier.color }}>
            <h3>{tier.name}</h3><span>{tier.bookIds.length} {tier.bookIds.length === 1 ? 'book' : 'books'}</span>
          </div>
          <BookZone {...props} id={tier.id} bookIds={tier.bookIds} />
        </section>
      ))}
    </div>
  );
}
