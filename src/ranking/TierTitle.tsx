import { useEffect, useRef, useState } from 'react';
import { deleteTier, tidy, updateTier, type BoardChange, type Tier } from '../board/board';
import { TierName } from './TierName';

export function TierTitle({
  tier,
  count,
  editing,
  onEdit,
  onClose,
  onChange,
}: {
  tier: Tier;
  count: number;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onChange: BoardChange;
}) {
  const [name, setName] = useState(tier.name);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const title = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const focusTitle = useRef(false);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      const length = input.current?.value.length ?? 0;
      input.current?.setSelectionRange(length, length);
    } else if (focusTitle.current) {
      title.current?.focus();
      focusTitle.current = false;
    }
  }, [editing]);

  useEffect(() => {
    if (!confirming) return;
    function resetOnOutsideClick(event: MouseEvent) {
      if (event.target instanceof Node && !remove.current?.contains(event.target)) setConfirming(false);
    }
    function resetOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setConfirming(false);
    }
    document.addEventListener('click', resetOnOutsideClick, true);
    document.addEventListener('keydown', resetOnEscape);
    return () => {
      document.removeEventListener('click', resetOnOutsideClick, true);
      document.removeEventListener('keydown', resetOnEscape);
    };
  }, [confirming]);

  function finishEditing() {
    const trimmed = tidy(name);
    if (!trimmed) {
      setName(tier.name);
      setError('Tier name cannot be empty. Previous name retained.');
      onClose();
    } else if (trimmed === tier.name || onChange((board) => updateTier(board, tier.id, { name: trimmed }))) {
      onClose();
    }
  }

  return (
    <div className="tier-label interactive-tier-label" style={{ backgroundColor: tier.color }}>
      <TierName name={editing ? name : tier.name}>
        {editing ? (
          <textarea
            ref={input}
            className="tier-name-input"
            rows={1}
            aria-label={`Name for tier ${tier.name}`}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError('');
            }}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                focusTitle.current = true;
                if (event.key === 'Escape') {
                  setName(tier.name);
                  setError('');
                  onClose();
                } else finishEditing();
              }
            }}
          />
        ) : (
          <button
            ref={title}
            type="button"
            className="tier-name-button"
            aria-label={`Rename tier ${tier.name}`}
            title="Click to rename"
            onClick={() => {
              setName(tier.name);
              setError('');
              onEdit();
            }}
          >
            {tier.name}
          </button>
        )}
      </TierName>
      <div className="tier-title-detail">
        <span className="tier-book-count">
          {tier.bookIds.length} {tier.bookIds.length === 1 ? 'book' : 'books'}
        </span>
        <div className="tier-title-actions tier-hover-control">
          <label className="tier-color-picker" title="Change tier color">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1-2.6H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" />
              <circle cx="7.5" cy="10" r=".8" />
              <circle cx="11" cy="6.8" r=".8" />
              <circle cx="16" cy="8" r=".8" />
              <circle cx="6.8" cy="14" r=".8" />
            </svg>
            <input
              type="color"
              aria-label={`Color for tier ${tier.name}`}
              value={tier.color}
              onChange={(event) => {
                const color = event.target.value;
                onChange((board) => updateTier(board, tier.id, { color }));
              }}
            />
          </label>
          <button
            ref={remove}
            type="button"
            className="tier-delete-button"
            aria-label={confirming ? `Confirm deletion of tier ${tier.name}` : `Delete tier ${tier.name}`}
            aria-pressed={confirming}
            disabled={count === 1}
            title={
              count === 1
                ? 'Keep at least one tier'
                : confirming
                  ? 'Click again to delete tier'
                  : `Delete tier ${tier.name}`
            }
            onClick={() => {
              if (confirming) {
                if (onChange((board) => deleteTier(board, tier.id))) onClose();
              } else {
                setConfirming(true);
                remove.current?.focus();
              }
            }}
          >
            {confirming ? (
              <span aria-hidden="true">?</span>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {error && (
        <p className="tier-name-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
