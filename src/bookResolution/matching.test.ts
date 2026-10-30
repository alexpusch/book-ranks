import { beforeEach, expect, it, vi } from 'vitest';
import { matchBook } from './matching';
import { extractBooks } from './extraction';
import type { EditionCandidate, WorkCandidate } from '../integrations/openLibrary/types';
import { openLibraryClient } from '../integrations/openLibrary/client';

vi.mock('../integrations/openLibrary/client', () => ({ openLibraryClient: { editions: vi.fn() } }));

const candidates: WorkCandidate[] = [
  { id: 'OL1W', title: 'Dune', authors: ['Frank Herbert'], covers: [], editions: [], nextCursor: '0' },
  { id: 'OL2W', title: 'Dune: A Study Guide', authors: ['Other'], covers: [{ coverId: 1 }], editions: [], nextCursor: '0' },
];
const prompt = vi.fn();
const destroy = vi.fn();
beforeEach(() => {
  prompt.mockReset().mockResolvedValue('{"workId":"OL1W"}');
  destroy.mockReset();
  vi.mocked(window.LanguageModel!.create).mockResolvedValue({ prompt, destroy });
  vi.mocked(openLibraryClient.editions).mockReset().mockResolvedValue({ editions: [], nextCursor: null });
});
it('sends titles, authors and identifiers and returns the original selected result, even without artwork', async () => {
  const result = await matchBook({ title: 'Dune: A Novel', author: 'F. Herbert' }, candidates, new AbortController().signal);
  expect(result).toBe(candidates[0]);
  expect(JSON.parse(prompt.mock.calls[0][0])).toEqual({
    requested: { title: 'Dune: A Novel', author: 'F. Herbert' },
    candidates: candidates.map(({ id, title, authors }) => ({ workId: id, title, authors })),
  });
  expect(destroy).toHaveBeenCalledOnce();
  expect(openLibraryClient.editions).not.toHaveBeenCalled();
});
it('allows no match and avoids the model entirely for empty searches', async () => {
  prompt.mockResolvedValueOnce('{"workId":null}');
  expect(await matchBook({ title: 'Dune', author: '' }, candidates, new AbortController().signal)).toBeNull();
  expect(await matchBook({ title: 'Dune', author: '' }, [], new AbortController().signal)).toBeNull();
  expect(prompt).toHaveBeenCalledOnce();
});
it.each(['not json', '{}', 'null', '{"workId":"OL999W"}', '{"workId":"OL1W","title":"Invented"}'])(
  'rejects invalid or invented matches: %s', async (output) => {
    prompt.mockResolvedValueOnce(output);
    await expect(matchBook({ title: 'Dune', author: '' }, candidates, new AbortController().signal)).rejects.toThrow();
    expect(destroy).toHaveBeenCalledOnce();
  },
);
it('serializes extraction and matching prompts and destroys each isolated session', async () => {
  let finish!: (response: string) => void;
  prompt.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce('{"workId":"OL1W"}');
  const extraction = extractBooks('Dune', vi.fn(), new AbortController().signal);
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
  const matching = matchBook({ title: 'Dune', author: '' }, candidates, new AbortController().signal);
  expect(prompt).toHaveBeenCalledOnce();
  finish('{"books":[{"title":"Dune","author":""}]}');
  await extraction;
  expect(await matching).toBe(candidates[0]);
  expect(destroy).toHaveBeenCalledTimes(2);
});

it.each(['missing', 'unavailable'] as const)('uses an available cover without requiring exact title or author matches when AI is %s', async (state) => {
  const create = window.LanguageModel!.create;
  if (state === 'missing') vi.stubGlobal('LanguageModel', undefined);
  else vi.mocked(window.LanguageModel!.availability).mockResolvedValue('unavailable');
  expect(await matchBook({ title: '  DUNE ', author: 'herbert' }, candidates, new AbortController().signal)).toBe(candidates[1]);
  expect(await matchBook({ title: 'Dune', author: '' }, candidates, new AbortController().signal)).toBe(candidates[1]);
  expect(create).not.toHaveBeenCalled();
});

it('always chooses a candidate without AI, using search order when no dated cover is available', async () => {
  vi.stubGlobal('LanguageModel', undefined);
  const other = { ...candidates[0], id: 'OL3W', authors: ['Other Author'], covers: [{ coverId: 123 }] };
  const signal = new AbortController().signal;
  expect(await matchBook({ title: 'Dune', author: '' }, [...candidates, other], signal)).toBe(candidates[1]);
  expect(await matchBook({ title: 'Unrelated title', author: 'Unrelated author' }, candidates, signal)).toBe(candidates[1]);
  expect(await matchBook({ title: 'Dune', author: '' }, [candidates[0], { ...candidates[0], id: 'OL4W' }], signal)).toBe(candidates[0]);
  expect(await matchBook({ title: 'Dune', author: '' }, [], signal)).toBeNull();
});

function edition(id: string, publicationDate?: string, coverId?: number): EditionCandidate {
  return {
    id, title: 'Dune', publicationDate, covers: coverId ? [{ coverId, editionId: id }] : [],
    languages: [], publishers: [], isbns: [],
  };
}

it('prefers the newest dated edition with artwork across candidates and never follows edition pages automatically', async () => {
  vi.stubGlobal('LanguageModel', undefined);
  const first = { ...candidates[0], covers: [{ coverId: 10 }] };
  vi.mocked(openLibraryClient.editions)
    .mockResolvedValueOnce({ editions: [
      edition('OL1M', '2020', 20), edition('OL2M', '2025-03-01', 25),
      edition('OL3M', '2026-01-01'), edition('OL4M', 'unknown', 40),
    ], nextCursor: '20' })
    .mockResolvedValueOnce({ editions: [
      edition('OL5M', '2025-09-10', 50), edition('OL6M', '2024', 60),
    ], nextCursor: '20' });
  const result = await matchBook({ title: 'Dune', author: '' }, [first, candidates[1]], new AbortController().signal);
  expect(result).toMatchObject({
    id: 'OL2W', covers: [{ coverId: 50, editionId: 'OL5M' }], nextCursor: '20',
  });
  expect(openLibraryClient.editions).toHaveBeenCalledTimes(2);
  expect(vi.mocked(openLibraryClient.editions).mock.calls.map(([input]) => input)).toEqual([
    { workId: 'OL1W', cursor: '0' }, { workId: 'OL2W', cursor: '0' },
  ]);
  expect(first.covers).toEqual([{ coverId: 10 }]);
});

it('keeps the first representative cover when edition dates are missing or invalid', async () => {
  vi.stubGlobal('LanguageModel', undefined);
  vi.mocked(openLibraryClient.editions).mockResolvedValue({ editions: [
    edition('OL1M', undefined, 10), edition('OL2M', 'not a date', 20), edition('OL3M', '2026'),
  ], nextCursor: null });
  expect(await matchBook({ title: 'Dune', author: '' }, candidates, new AbortController().signal)).toBe(candidates[1]);
});

it('keeps search and edition order stable when release dates tie', async () => {
  vi.stubGlobal('LanguageModel', undefined);
  vi.mocked(openLibraryClient.editions).mockResolvedValue({ editions: [
    edition('OL1M', '2025', 10), edition('OL2M', '2025', 20),
  ], nextCursor: null });
  const first = { ...candidates[0], covers: [{ coverId: 1 }] };
  const result = await matchBook({ title: 'Dune', author: '' }, [first, candidates[1]], new AbortController().signal);
  expect(result).toMatchObject({ id: 'OL1W', covers: [{ coverId: 10, editionId: 'OL1M' }] });
});

it('surfaces edition lookup failures and ignores cancelled edition results', async () => {
  vi.stubGlobal('LanguageModel', undefined);
  vi.mocked(openLibraryClient.editions).mockRejectedValueOnce(new Error('Edition lookup failed'));
  await expect(matchBook({ title: 'Dune', author: '' }, candidates, new AbortController().signal)).rejects.toThrow('Edition lookup failed');
  const controller = new AbortController();
  vi.mocked(openLibraryClient.editions).mockImplementationOnce(async () => {
    controller.abort();
    return { editions: [edition('OL1M', '2025', 10)], nextCursor: null };
  });
  await expect(matchBook({ title: 'Dune', author: '' }, candidates, controller.signal)).rejects.toThrow();
});

it('does not silently fall back when an availability check fails', async () => {
  vi.mocked(window.LanguageModel!.availability).mockRejectedValue(new Error('Availability failed'));
  await expect(matchBook({ title: 'Dune', author: '' }, candidates, new AbortController().signal)).rejects.toThrow('Availability failed');
});

it('honors cancellation before applying a non-AI match', async () => {
  vi.stubGlobal('LanguageModel', undefined);
  const controller = new AbortController();
  controller.abort();
  await expect(matchBook({ title: 'Dune', author: '' }, candidates, controller.signal)).rejects.toThrow();
});
