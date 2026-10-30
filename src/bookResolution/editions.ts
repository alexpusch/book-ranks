import { useEffect, useRef, useState } from 'react';
import type { Book } from '../board/board';
import { openLibraryClient } from '../integrations/openLibrary/client';
import type { WorkCandidate } from '../integrations/openLibrary/types';

export function useEditions(workId: string | undefined, book: Pick<Book, 'title' | 'author'>) {
  const [editionWork, setEditionWork] = useState<WorkCandidate | null>(null);
  const [editionBusy, setEditionBusy] = useState(false);
  const [editionError, setEditionError] = useState('');
  const editionController = useRef<AbortController | null>(null);
  useEffect(() => {
    setEditionWork(null);
    setEditionError('');
    setEditionBusy(false);
    return () => { editionController.current?.abort(); editionController.current = null; };
  }, [workId]);
  async function loadEditions() {
    if (!workId || editionController.current) return;
    const controller = new AbortController();
    editionController.current = controller;
    setEditionBusy(true);
    setEditionError('');
    try {
      const page = await openLibraryClient.editions({
        workId, cursor: editionWork?.nextCursor ?? '0',
      }, controller.signal);
      controller.signal.throwIfAborted();
      setEditionWork((current) => ({
        id: workId, title: book.title, authors: [book.author],
        covers: [], editions: [...(current?.editions ?? []), ...page.editions], nextCursor: page.nextCursor,
      }));
    } catch (error) {
      if (!controller.signal.aborted) setEditionError(error instanceof Error ? error.message : 'Edition search failed.');
    } finally {
      if (editionController.current === controller) {
        editionController.current = null;
        setEditionBusy(false);
      }
    }
  }

  return { editionWork, editionBusy, editionError, loadEditions };
}
