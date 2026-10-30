import { workPattern, editionPattern } from '../integrations/openLibrary/types';

export type CoverSelection = { kind: 'placeholder' } | { kind: 'local'; dataUrl: string } | {
  kind: 'open-library'; workId: string; editionId?: string; coverId: number;
};

export const MAX_LOCAL_COVER_LENGTH = 1_000_000;

export function validateSelection(value: unknown): CoverSelection {
  if (!value || typeof value !== 'object') throw new Error('Invalid saved cover selection.');
  const item = value as Record<string, unknown>;
  if (item.kind === 'placeholder' && Object.keys(item).length === 1) return { kind: 'placeholder' };
  if (item.kind === 'local' && typeof item.dataUrl === 'string' && item.dataUrl.length <= MAX_LOCAL_COVER_LENGTH &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u.test(item.dataUrl) &&
    Object.keys(item).every((key) => ['kind', 'dataUrl'].includes(key))) {
    return { kind: 'local', dataUrl: item.dataUrl };
  }
  if (item.kind !== 'open-library' || typeof item.workId !== 'string' || !workPattern.test(item.workId) ||
    !Number.isSafeInteger(item.coverId) || Number(item.coverId) <= 0 ||
    (item.editionId !== undefined && (typeof item.editionId !== 'string' || !editionPattern.test(item.editionId))) ||
    Object.keys(item).some((key) => !['kind', 'workId', 'editionId', 'coverId'].includes(key))) {
    throw new Error('Invalid saved cover selection.');
  }
  return { kind: 'open-library', workId: item.workId, coverId: Number(item.coverId),
    ...(typeof item.editionId === 'string' ? { editionId: item.editionId } : {}) };
}
