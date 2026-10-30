import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36');
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ docs: [] }))));
  vi.stubGlobal('LanguageModel', {
    availability: vi.fn().mockResolvedValue('available'),
    create: vi.fn().mockResolvedValue({
      prompt: vi.fn(async (text: string) => {
        if (text.startsWith('{"requested":')) {
          const data = JSON.parse(text);
          return JSON.stringify({ workId: data.candidates[0]?.workId ?? null });
        }
        return JSON.stringify({ books: text.split(/\r?\n/u).filter((line) => line.trim()).map((line) => {
          const [title, author = ''] = line.split('|');
          return { title, author };
        }) });
      }),
      destroy: vi.fn(),
    }),
  });
});

Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); },
  },
  close: {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute('open'); },
  },
});
