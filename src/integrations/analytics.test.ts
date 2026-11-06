import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeAnalytics } from './analytics';

const tagUrl = 'https://www.googletagmanager.com/gtm.js?id=GTM-5PTM3JVS';

function setEnvironment(url: string, production = true) {
  vi.stubEnv('PROD', production);
  vi.stubGlobal('window', { location: new URL(url) });
}

afterEach(() => {
  document.querySelectorAll(`script[src="${tagUrl}"]`).forEach((script) => script.remove());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('analytics', () => {
  it('initializes the GTM queue before loading the production tag asynchronously', () => {
    setEnvironment('https://alexpusch.github.io/book-ranks/');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const appendChild = vi.spyOn(document.head, 'appendChild');

    initializeAnalytics();

    expect(window.dataLayer).toEqual([{ 'gtm.start': now, event: 'gtm.js' }]);
    expect(appendChild).toHaveBeenCalledOnce();
    const script = document.querySelector<HTMLScriptElement>(`script[src="${tagUrl}"]`);
    expect(script?.async).toBe(true);
  });

  it('preserves existing data-layer entries', () => {
    setEnvironment('https://alexpusch.github.io/book-ranks/');
    const dataLayer: unknown[] = [{ event: 'existing' }];
    window.dataLayer = dataLayer;

    initializeAnalytics();

    expect(window.dataLayer).toBe(dataLayer);
    expect(dataLayer).toEqual([{ event: 'existing' }, { 'gtm.start': expect.any(Number), event: 'gtm.js' }]);
  });

  it.each([
    'http://localhost:5173/',
    'http://app.localhost/',
    'http://127.0.0.1:4173/',
    'http://127.0.0.2/',
    'http://[::1]:4173/',
  ])('does not initialize analytics on %s, even in production', (url) => {
    setEnvironment(url);

    initializeAnalytics();

    expect(window.dataLayer).toBeUndefined();
    expect(document.querySelector(`script[src="${tagUrl}"]`)).toBeNull();
  });

  it('does not initialize analytics in development on a non-local hostname', () => {
    setEnvironment('https://alexpusch.github.io/book-ranks/', false);

    initializeAnalytics();

    expect(window.dataLayer).toBeUndefined();
    expect(document.querySelector(`script[src="${tagUrl}"]`)).toBeNull();
  });
});
