import { expect, test } from './fixtures';

const canonicalUrl = 'https://alexpusch.github.io/book-ranks/';
const title = 'Free Book Tier List Maker & Book Ranking | Book ranks';
const description = 'Create a free book tier list with cover art. Rank your favorite books, customize tiers, and download your book rankings as a JPEG. No account needed.';

test('search metadata is available without JavaScript and no SEO footer is included', async ({ browser, request }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page).toHaveTitle(title);
    await expect(page.locator('footer')).toHaveCount(0);
    const html = await (await request.get('/')).text();
    expect(html).toContain('<noscript>');
    expect(html).toContain('Enable JavaScript to add books');
    await expect(page.locator('#root')).toBeEmpty();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', description);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonicalUrl);

    for (const prefix of ['og', 'twitter']) {
      const attribute = prefix === 'og' ? 'property' : 'name';
      await expect(page.locator(`meta[${attribute}="${prefix}:title"]`)).toHaveAttribute('content', title);
      await expect(page.locator(`meta[${attribute}="${prefix}:description"]`)).toHaveAttribute('content', description);
    }
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonicalUrl);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary');
    const structuredData = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText());
    expect(structuredData).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Book ranks',
      url: canonicalUrl,
      description,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    });

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()['content-type']).toContain('xml');
    await page.goto('/sitemap.xml');
    await expect(page.locator('urlset')).toHaveAttribute('xmlns', 'http://www.sitemaps.org/schemas/sitemap/0.9');
    await expect(page.locator('url > loc')).toHaveCount(1);
    await expect(page.locator('url > loc')).toHaveText(canonicalUrl);
  } finally {
    await context.close();
  }
});

test('mobile app has no SEO footer and query URLs stay canonical', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?ai=true&source=share');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonicalUrl);
  await expect(page.locator('.app-guide')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'AI assisted', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manual entry', exact: true }).click();
  await expect(page.getByLabel('Book name', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How to make a book tier list' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText('Enable JavaScript to add books', { exact: false })).toHaveCount(0);
});
