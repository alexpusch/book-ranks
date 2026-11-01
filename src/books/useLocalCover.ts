import { useEffect, useRef, useState } from 'react';
import type { CoverSelection } from '../board/coverSelection';
import { readLocalCover } from './localCover';

export function useLocalCover() {
  const imageController = useRef<AbortController | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  useEffect(() => () => imageController.current?.abort(), []);

  async function selectImage(file: File, onSelect: (selection: CoverSelection) => void) {
    if (imageController.current) return;
    const controller = new AbortController();
    imageController.current = controller;
    setImageBusy(true);
    setImageError('');
    try {
      const selection = await readLocalCover(file, controller.signal);
      controller.signal.throwIfAborted();
      onSelect(selection);
    } catch (error) {
      if (!controller.signal.aborted) setImageError(error instanceof Error ? error.message : 'Could not load the cover image.');
    } finally {
      if (!controller.signal.aborted) setImageBusy(false);
      if (imageController.current === controller) imageController.current = null;
    }
  }

  return { selectImage, imageBusy, imageError, setImageError };
}
