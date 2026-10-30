import type { CoverSelection } from '../board/coverSelection';
import type { WorkCandidate } from '../integrations/openLibrary/types';
import { CoverImage } from './CoverImage';

function isSelectedCover(selection: CoverSelection, current?: CoverSelection): boolean {
  if (selection.kind === 'local') return current?.kind === 'local' && current.dataUrl === selection.dataUrl;
  return selection.kind === 'placeholder' ? current?.kind === 'placeholder'
    : current?.kind === 'open-library' && current.workId === selection.workId &&
      current.editionId === selection.editionId && current.coverId === selection.coverId;
}

export function CoverOption({ selection, current, label, date, onSelect }: {
  selection: CoverSelection; current?: CoverSelection; label: string; date?: string;
  onSelect: (selection: CoverSelection) => void;
}) {
  return <div className="cover-option">
    <CoverImage selection={selection} title={label} selected={isSelectedCover(selection, current)} onSelect={() => onSelect(selection)} />
    {date && <span className="cover-date">{date}</span>}
  </div>;
}

export function CoverGallery({ works, current, onSelect }: {
  works: WorkCandidate[]; current?: CoverSelection; onSelect: (selection: CoverSelection) => void;
}) {
  type Option = { selection: Extract<CoverSelection, { kind: 'open-library' }>; label: string; date?: string };
  const options = new Map<number, Option>();
  function add(option: Option) {
    const existing = options.get(option.selection.coverId);
    if (!existing || isSelectedCover(option.selection, current) || (!isSelectedCover(existing.selection, current) &&
      !existing.selection.editionId && option.selection.editionId)) {
      options.set(option.selection.coverId, option);
    }
  }
  for (const work of works) {
    for (const { coverId, editionId } of work.covers) add({
      selection: { kind: 'open-library', workId: work.id, coverId, ...(editionId ? { editionId } : {}) },
      label: editionId ? `edition ${editionId} of ${work.title}` : `representative cover of ${work.title}`,
    });
    for (const edition of work.editions) {
      for (const { coverId } of edition.covers) add({
        selection: { kind: 'open-library', workId: work.id, editionId: edition.id, coverId },
        label: `edition ${edition.id} of ${work.title}${edition.publicationDate ? `, ${edition.publicationDate}` : ''}`,
        date: edition.publicationDate,
      });
    }
  }
  return [...options.values()].map((option) =>
    <CoverOption key={option.selection.coverId} {...option} current={current} onSelect={onSelect} />);
}
