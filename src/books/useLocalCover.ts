import { useEffect, useRef, useState } from 'react';
import type { CoverSelection } from '../board/coverSelection';
import { readLocalCover } from './localCover';

export function useLocalCover() {
  const imageController = useRef<AbortController | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  useEffect(() => () => imageController.current?.abort(), []);

  async function loadImage(source: File | (() => Promise<File>), onSelect: (selection: CoverSelection) => void) {
    if (imageController.current) return;
    const controller = new AbortController();
    imageController.current = controller;
    setImageBusy(true);
    setImageError('');
    try {
      const file = typeof source === 'function' ? await source() : source;
      controller.signal.throwIfAborted();
      const selection = await readLocalCover(file, controller.signal);
      controller.signal.throwIfAborted();
      onSelect(selection);
    } catch (error) {
      if (!controller.signal.aborted)
        setImageError(error instanceof Error ? error.message : 'Could not load the cover image.');
    } finally {
      if (!controller.signal.aborted) setImageBusy(false);
      if (imageController.current === controller) imageController.current = null;
    }
  }

  function selectImage(file: File, onSelect: (selection: CoverSelection) => void) {
    return loadImage(file, onSelect);
  }

  function pasteImage(onSelect: (selection: CoverSelection) => void) {
    return loadImage(async () => {
      if (!navigator.clipboard?.read)
        throw new Error('Reading clipboard images is not supported in this browser. Upload a photo instead.');
      let items: ClipboardItem[];
      try {
        items = await navigator.clipboard.read();
      } catch {
        throw new Error('Could not read the clipboard. Allow clipboard access and try again, or upload a photo.');
      }
      for (const item of items) {
        const type = item.types.find((type) => type.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          return new File([blob], 'pasted-cover', { type });
        }
      }
      throw new Error('No image found on the clipboard. Copy an image and try again, or upload a photo.');
    }, onSelect);
  }

  return { selectImage, pasteImage, imageBusy, imageError };
}
