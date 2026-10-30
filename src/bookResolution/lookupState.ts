import type { Book } from '../board/board';
import type { CoverSelection } from '../board/coverSelection';
import { normalize, type LookupInput, type WorkCandidate } from '../integrations/openLibrary/types';

export interface LookupResult {
  outcome: 'matched' | 'needs-review' | 'not-found' | 'error';
  works: WorkCandidate[]; selection?: CoverSelection;
  warning?: string; error?: string;
}

export type LookupState = LookupResult | { outcome: 'queued' } | { outcome: 'loading' } | { outcome: 'extracting' };

function metadataIdentity(input: LookupInput): string {
  const author = input.author ? normalize(input.author) : '';
  return JSON.stringify([1, normalize(input.title), author && author !== 'unknown author' ? author : null]);
}

export function lookupIdentity(book: Book): string {
  return JSON.stringify([metadataIdentity(book), book.pendingInput ?? null]);
}
