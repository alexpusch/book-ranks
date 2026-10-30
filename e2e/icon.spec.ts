import { expect, test } from './fixtures';

test('the production app serves its browser and home-screen icons', async ({ page, request }) => {
  await page.goto('/');

  const icons = [
    { selector: 'link[rel="icon"][type="image/svg+xml"]', type: 'image/svg+xml', size: 32 },
    { selector: 'link[rel="icon"][type="image/png"][sizes="32x32"]', type: 'image/png', size: 32 },
    { selector: 'link[rel="apple-touch-icon"][sizes="180x180"]', type: 'image/png', size: 180 },
  ];

  for (const icon of icons) {
    const link = page.locator(`head > ${icon.selector}`);
    await expect(link).toHaveCount(1);
    const href = await link.getAttribute('href');
    if (!href) throw new Error(`Missing icon URL: ${icon.selector}`);

    const response = await request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain(icon.type);

    const image = await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();

      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable.');
      context.drawImage(image, 0, 0, 32, 32);
      const pixels = context.getImageData(0, 0, 32, 32).data;
      const pixel = (x: number, y: number) => Array.from(pixels.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
      const edges = { top: 0, right: 0, bottom: 0, left: 0 };
      for (let offset = 0; offset < 32; offset += 1) {
        if (pixel(offset, 0)[3] > 200) edges.top += 1;
        if (pixel(31, offset)[3] > 200) edges.right += 1;
        if (pixel(offset, 31)[3] > 200) edges.bottom += 1;
        if (pixel(0, offset)[3] > 200) edges.left += 1;
      }
      const top = pixel(16, 0);
      const topInside = pixel(16, 3);
      const right = pixel(31, 15);
      const rightInside = pixel(28, 15);

      canvas.width = 16;
      canvas.height = 16;
      context.drawImage(image, 0, 0, 16, 16);
      const color = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        edges,
        top,
        topInside,
        right,
        rightInside,
        cover: color(7, 2),
        tiers: [color(7, 6), color(7, 9), color(7, 12)],
      };
    }, href);

    expect(image.width).toBe(icon.size);
    expect(image.height).toBe(icon.size);
    for (const edge of Object.values(image.edges)) expect(edge).toBeGreaterThanOrEqual(26);

    const colorDifference = (a: number[], b: number[]) =>
      a.slice(0, 3).reduce((sum, channel, index) => sum + Math.abs(channel - b[index]), 0);
    expect(colorDifference(image.top, image.topInside)).toBeLessThan(15);
    expect(colorDifference(image.right, image.rightInside)).toBeLessThan(15);
    for (const tier of image.tiers) expect(colorDifference(tier, image.cover)).toBeGreaterThan(80);
  }
});
