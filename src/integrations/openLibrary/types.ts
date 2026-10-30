export interface LookupInput { title: string; author?: string }
export interface EditionInput { workId: string; cursor?: string }
export interface CoverCandidate { coverId: number; editionId?: string }
export interface EditionCandidate {
  id: string; title: string; languages: string[]; publishers: string[];
  publicationDate?: string; isbns: string[]; covers: CoverCandidate[];
}
export interface WorkCandidate {
  id: string; title: string; authors: string[]; covers: CoverCandidate[];
  editions: EditionCandidate[]; nextCursor: string | null;
}
export interface EditionPage { editions: EditionCandidate[]; nextCursor: string | null }
export const workPattern = /^OL[1-9]\d*W$/u;
export const editionPattern = /^OL[1-9]\d*M$/u;
export const normalize = (value: string) => value.trim().replace(/\s+/gu, ' ').toLowerCase();
export function coverUrl(coverId: number, size: 'M' | 'L' = 'M'): string {
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg?default=false`;
}
