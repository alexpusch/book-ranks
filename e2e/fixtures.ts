import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://openlibrary.org/**', (route) => route.fulfill({ json: { docs: [] } }));
    await page.addInitScript(() => {
      // Browser tests use deterministic output rather than downloading a real model.
      Object.defineProperty(window, 'LanguageModel', {
        configurable: true,
        value: {
          availability: async () => 'available',
          create: async () => ({
            prompt: async (text: string) => {
              if (text.startsWith('{"requested":')) {
                const data = JSON.parse(text);
                return JSON.stringify({ workId: data.candidates[0]?.workId ?? null });
              }
              return JSON.stringify({ books: text.split(/\r?\n/u).filter((line) => line.trim()).map((line) => {
                const [title, author = ''] = line.split('|');
                return { title, author };
              }) });
            },
            destroy() {},
          }),
        },
      });
    });
    await use(page);
  },
});
