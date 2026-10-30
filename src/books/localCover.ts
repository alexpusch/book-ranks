import { MAX_LOCAL_COVER_LENGTH, type CoverSelection } from '../board/coverSelection';

export async function readLocalCover(file: File, signal: AbortSignal): Promise<CoverSelection> {
  if (!/^image\/(jpeg|png|webp|gif|avif)$/u.test(file.type)) {
    throw new Error('Choose a JPEG, PNG, WebP, GIF, or AVIF image.');
  }
  if (!file.size || file.size > 15_000_000) throw new Error('Choose an image smaller than 15 MB.');
  signal.throwIfAborted();
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be opened. Try another image.');
  }
  try {
    signal.throwIfAborted();
    if (!image.width || !image.height || image.width * image.height > 40_000_000) {
      throw new Error('Choose an image with at most 40 million pixels.');
    }
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare the cover image.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if (!dataUrl.startsWith('data:image/jpeg;base64,') || dataUrl.length > MAX_LOCAL_COVER_LENGTH) {
      throw new Error('This image is too large to save. Try a smaller or simpler image.');
    }
    return { kind: 'local', dataUrl };
  } finally {
    image.close();
  }
}
