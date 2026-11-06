declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export function initializeAnalytics() {
  const hostname = window.location.hostname;
  if (
    !import.meta.env.PROD ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127\./u.test(hostname)
  ) {
    return;
  }

  window.dataLayer ??= [];
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-5PTM3JVS';
  document.head.appendChild(script);
}
