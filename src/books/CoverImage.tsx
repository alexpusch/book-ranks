import { useState } from 'react';
import type { CoverSelection } from '../board/coverSelection';
import { coverUrl } from '../integrations/openLibrary/types';
import placeholder from './assets/cover.svg';

export function CoverImage({ selection, title = '', size = 'M', onSelect, selected }: {
  selection?: CoverSelection; title?: string; size?: 'M' | 'L';
  onSelect?: () => void; selected?: boolean;
}) {
  const src = selection?.kind === 'local' ? selection.dataUrl
    : selection?.kind === 'open-library' ? coverUrl(selection.coverId, size) : placeholder;
  const [failed, setFailed] = useState<string | null>(null);
  const image = <img className="book-cover" src={failed === src ? placeholder : src} alt="" width="180" height="240" draggable={false}
      data-cover-url={src} data-selected-cover={selection && selection.kind !== 'placeholder' ? 'true' : undefined}
      data-book-title={title} onError={() => setFailed(src)} />;
  return <>
    {onSelect ? <button type="button" className="cover-choice" aria-label={`Select ${title}`} aria-pressed={selected}
      onClick={onSelect}>{image}</button> : image}
    {failed === src && <span className="cover-warning">Artwork unavailable. <button type="button"
      onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setFailed(null); }}>Retry image</button></span>}
  </>;
}
