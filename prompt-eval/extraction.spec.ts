import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { BookInput } from '../src/board/board';
import { extractionCases, type ExtractionCase } from './cases';

interface ExtractionResult {
  books?: BookInput[];
  error?: string;
  statuses: string[];
  durationMs: number;
}

let context: BrowserContext;
let page: Page;
let environment: { userAgent: string; availability: string; headless: boolean; profile: string };

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(900_000);
  const profile = resolve(process.env.CHROME_AI_PROFILE ?? '.scratch/chrome-ai');
  context = await chromium.launchPersistentContext(
    profile,
    {
      channel: 'chrome',
      headless: true,
      // Playwright's defaults disable OptimizationHints and component updates needed by Chrome AI.
      ignoreDefaultArgs: true,
      args: [
        `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-first-run', '--headless=new', 'about:blank',
      ],
    },
  );
  page = await context.newPage();
  if (!baseURL) throw new Error('The prompt evaluation requires a configured baseURL.');
  await page.goto(baseURL);
  page.on('console', (message) => {
    if (message.text().startsWith('Chrome AI download:')) console.log(message.text());
  });
  const availability = await page.evaluate(async () => window.LanguageModel?.availability());
  if (!availability || availability === 'unavailable') {
    throw new Error(
      `Real Chrome AI is ${availability ?? 'missing'}. Enable the Prompt API in a supported desktop Chrome ` +
      'and prepare a dedicated profile with CHROME_AI_PROFILE. See README.md#real-model-prompt-evaluation. ' +
      'No mocked model or skipped evaluation is used.',
    );
  }
  environment = { userAgent: await page.evaluate(() => navigator.userAgent), availability, headless: true, profile };
  console.log(environment);
  if (availability !== 'available') {
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.evaluate(async () => {
      const session = await window.LanguageModel!.create({
        initialPrompts: [],
        signal: AbortSignal.timeout(840_000),
        monitor(monitor) {
          let previousPercent = -1;
          monitor.addEventListener('downloadprogress', ({ loaded }) => {
            const percent = Math.round(loaded * 100);
            if (percent !== previousPercent) {
              console.info(`Chrome AI download: ${percent}%`);
              previousPercent = percent;
            }
          });
        },
      });
      session.destroy();
    });
  }
});

test.afterAll(async () => {
  await context?.close();
});

test(`extracts minimal, discriminative search terms: ${extractionCases.length} real-model cases`, async ({}, testInfo) => {
  test.setTimeout(extractionCases.length * 180_000);
  let passed = 0;
  const results: (ExtractionCase & ExtractionResult & { passed: boolean })[] = [];
  for (const example of extractionCases) {
    await test.step(`${example.category}: ${example.id}`, async () => {
      const result = await page.evaluate(async (input) => {
        const modulePath = '/src/bookResolution/extraction.ts';
        const { extractBooks }: typeof import('../src/bookResolution/extraction') = await import(/* @vite-ignore */ modulePath);
        const statuses: string[] = [];
        const start = performance.now();
        try {
          const books = await extractBooks(input, (status) => statuses.push(status), AbortSignal.timeout(150_000));
          return { books, statuses, durationMs: performance.now() - start };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
            statuses,
            durationMs: performance.now() - start,
          };
        }
      }, example.input);
      const matches = 'expectedError' in example
        ? result.error?.startsWith(example.expectedError) === true
        : !result.error && example.accepted.some((books) => isDeepStrictEqual(books, result.books));
      if (matches) passed++;
      const outcome = { ...example, ...result, passed: matches };
      results.push(outcome);
      await testInfo.attach(example.id, {
        body: JSON.stringify(outcome, null, 2),
        contentType: 'application/json',
      });
      console.log(`${matches ? 'PASS' : 'FAIL'} ${example.category}: ${example.id}`);
      expect.soft(matches, JSON.stringify(outcome, null, 2)).toBe(true);
    });
  }
  const summary = { environment, passed, total: extractionCases.length, results };
  await testInfo.attach('evaluation-summary', {
    body: JSON.stringify(summary, null, 2),
    contentType: 'application/json',
  });
  console.log(`Prompt evaluation: ${passed}/${extractionCases.length} cases passed.`);
});
