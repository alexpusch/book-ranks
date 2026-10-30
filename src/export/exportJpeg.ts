import { toJpeg } from 'html-to-image';

import placeholder from '../books/assets/cover.svg';

export class CoverExportError extends Error {
  constructor(public readonly titles: string[]) {
    super(`Selected artwork could not be embedded for: ${titles.join(', ')}. Retry export or explicitly export with placeholders.`);
  }
}
async function bounded<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out.`)), 12_000);
    })]);
  } finally { clearTimeout(timer); }
}
async function imageBytes(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
  const blob = await response.blob();
  if (!blob.size || blob.size > 15_000_000 || !/^image\/(jpeg|png|webp|svg\+xml)$/u.test(blob.type)) {
    throw new Error('Image response cannot be embedded.');
  }
  const data = await bounded(new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read cover image.'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image bytes.'));
    reader.readAsDataURL(blob);
  }), 'Reading artwork');
  const image = new Image();
  image.src = data;
  await bounded(image.decode(), 'Decoding artwork');
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Artwork has no dimensions.');
  return data;
}
export async function exportJpeg(element: HTMLElement, allowPlaceholders = false): Promise<void> {
  const snapshot = element.cloneNode(true) as HTMLElement;
  const theme = getComputedStyle(element);
  for (const property of Array.from(theme)) {
    if (property.startsWith('--')) snapshot.style.setProperty(property, theme.getPropertyValue(property));
  }
  const backgroundColor = getComputedStyle(element.querySelector('.export-board') ?? element).backgroundColor;
  const stage = document.createElement('div');
  stage.style.position = 'absolute';
  stage.style.left = '-24000px';
  stage.style.width = `${element.scrollWidth}px`;
  stage.setAttribute('aria-hidden', 'true');
  stage.append(snapshot);
  document.body.append(stage);
  try {
  await bounded(document.fonts.ready, 'Loading fonts');
  const images = Array.from(snapshot.querySelectorAll('img'));
  const verified = new Map<string, Promise<string>>();
  function load(url: string) {
    let task = verified.get(url);
    if (!task) { task = imageBytes(url); verified.set(url, task); }
    return task;
  }
  const failures: string[] = [];
  await Promise.all(images.map(async (image) => {
    const selected = image.dataset.selectedCover === 'true';
    const source = image.dataset.coverUrl ?? image.src;
    try {
      image.src = await load(selected && source.startsWith('https://covers.openlibrary.org/')
        ? source.replace('-M.jpg', '-L.jpg') : source);
    } catch (error) {
      if (!selected) throw error;
      failures.push(image.dataset.bookTitle ?? 'Untitled book');
      if (allowPlaceholders) image.src = await load(placeholder);
    }
  }));
  if (failures.length && !allowPlaceholders) throw new CoverExportError(failures);
  snapshot.querySelectorAll('.cover-warning').forEach((warning) => warning.remove());
  await Promise.all(images.map((image) => bounded(image.decode(), 'Decoding export image')));
  const width = snapshot.scrollWidth;
  const height = snapshot.scrollHeight;
  // Keep the entire board within browser canvas limits without silently cropping.
  const pixelRatio = Math.min(1, 16000 / Math.max(width, height));
  if (pixelRatio < 0.5 || width * height * pixelRatio ** 2 > 100_000_000) {
    throw new Error('This board is too large to export safely. Try fewer books or tiers.');
  }
  const jpeg = await bounded(toJpeg(snapshot, {
    quality: 0.95,
    backgroundColor,
    width,
    height,
    pixelRatio,
    skipFonts: true,
    includeQueryParams: true,
  }), 'Creating JPEG');
  if (!jpeg.startsWith('data:image/jpeg;base64,') || jpeg.length < 100) {
    throw new Error('The browser could not create the JPEG.');
  }
  const link = document.createElement('a');
  link.download = 'my-book-tier-list.jpg';
  link.href = jpeg;
  link.click();
  } finally { stage.remove(); }
}
