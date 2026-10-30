import { afterEach, expect, it, vi } from 'vitest';
import { readLocalCover } from './localCover';
import { MAX_LOCAL_COVER_LENGTH } from '../board/coverSelection';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('rejects unsupported, empty, and oversized files before decoding', async () => {
  const decode = vi.fn();
  vi.stubGlobal('createImageBitmap', decode);
  const signal = new AbortController().signal;
  await expect(readLocalCover(new File(['text'], 'cover.txt', { type: 'text/plain' }), signal)).rejects.toThrow('Choose a JPEG');
  await expect(readLocalCover(new File([], 'cover.png', { type: 'image/png' }), signal)).rejects.toThrow('15 MB');
  await expect(readLocalCover(new File([new Uint8Array(15_000_001)], 'cover.png', { type: 'image/png' }), signal)).rejects.toThrow('15 MB');
  expect(decode).not.toHaveBeenCalled();
});

it('resizes locally, flattens transparency, and releases the decoded image', async () => {
  const image = { width: 2400, height: 3600, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(image));
  const fillRect = vi.fn();
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect, drawImage } as unknown as CanvasRenderingContext2D);
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,Y292ZXI=');
  const result = await readLocalCover(new File(['png'], 'cover.png', { type: 'image/png' }), new AbortController().signal);
  expect(result).toEqual({ kind: 'local', dataUrl: 'data:image/jpeg;base64,Y292ZXI=' });
  expect(fillRect).toHaveBeenCalledWith(0, 0, 800, 1200);
  expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 800, 1200);
  expect(encode).toHaveBeenCalledWith('image/jpeg', 0.85);
  expect(image.close).toHaveBeenCalledOnce();
});

it('reports decoding failures', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('Invalid bytes')));
  await expect(readLocalCover(new File(['bad'], 'cover.png', { type: 'image/png' }), new AbortController().signal))
    .rejects.toThrow('could not be opened');
});

it('does not use an image after the editor closes', async () => {
  const controller = new AbortController();
  const image = { width: 10, height: 10, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => { controller.abort(); return image; }));
  await expect(readLocalCover(new File(['png'], 'cover.png', { type: 'image/png' }), controller.signal))
    .rejects.toThrow();
  expect(image.close).toHaveBeenCalledOnce();
});

it('bounds decoded dimensions and encoded storage size', async () => {
  const image = { width: 10000, height: 10000, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(image));
  const file = new File(['png'], 'cover.png', { type: 'image/png' });
  await expect(readLocalCover(file, new AbortController().signal)).rejects.toThrow('40 million pixels');
  image.width = 1200; image.height = 1200;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(), drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(`data:image/jpeg;base64,${'A'.repeat(MAX_LOCAL_COVER_LENGTH)}`);
  await expect(readLocalCover(file, new AbortController().signal)).rejects.toThrow('too large to save');
  expect(image.close).toHaveBeenCalledTimes(2);
});
