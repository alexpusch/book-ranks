import { useEffect, useRef, useState } from 'react';
import { addTier, deleteTier, reorderTier, updateTier, type Board, type Tier } from '../board/board';

function TierEditor({ tier, index, count, onChange }: {
  tier: Tier;
  index: number;
  count: number;
  onChange: (operation: (board: Board) => Board) => void;
}) {
  const [name, setName] = useState(tier.name);
  const [error, setError] = useState('');
  return (
    <div className="tier-editor">
      <div className="tier-editor-fields">
        <input type="color" value={tier.color} aria-label={`Color for tier ${tier.name}`}
          onChange={(event) => onChange((board) => updateTier(board, tier.id, { color: event.target.value }))} />
        <label className="tier-name-field">Tier name
          <input value={name} aria-label={`Name for tier ${index + 1}`} aria-invalid={!!error}
            onChange={(event) => { setName(event.target.value); setError(''); }}
            onBlur={() => {
              if (!name.trim()) {
                setError('Tier name cannot be empty. Previous name retained.');
                setName(tier.name);
              } else {
                onChange((board) => updateTier(board, tier.id, { name: name.trim() }));
              }
            }} />
        </label>
      </div>
      <div className="tier-editor-actions">
        <button className="icon-button" disabled={index === 0} aria-label={`Move tier ${tier.name} up`}
          onClick={() => onChange((board) => reorderTier(board, tier.id, -1))}>↑</button>
        <button className="icon-button" disabled={index === count - 1} aria-label={`Move tier ${tier.name} down`}
          onClick={() => onChange((board) => reorderTier(board, tier.id, 1))}>↓</button>
        <button className="text-button danger" disabled={count === 1} aria-label={`Delete tier ${tier.name}`}
          onClick={() => onChange((board) => deleteTier(board, tier.id))}>Delete</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function TierSettings({ board, onChange, onClose }: {
  board: Board;
  onChange: (operation: (board: Board) => Board) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog className="settings-drawer" ref={dialog} onCancel={onClose} aria-labelledby="settings-title">
      <div className="drawer-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h2 id="settings-title">Tier settings</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close settings">×</button></div>
      <p className="muted">Every reader has their own scale. Set up yours.</p>
      {board.tiers.map((tier, index) => (
        <TierEditor key={tier.id} tier={tier} index={index} count={board.tiers.length} onChange={onChange} />
      ))}
      <button className="secondary-button full-width" onClick={() => onChange(addTier)}>+ Add a tier</button>
      <p className="settings-note">Deleting a tier returns its books to the reading pile. Keep at least one tier.</p>
      <button className="primary-button full-width" onClick={onClose}>Done</button>
    </dialog>
  );
}
