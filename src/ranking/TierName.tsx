import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function TierName({ name, children }: { name: string; children?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const element = heading.current!;
    function fit() {
      element.style.fontSize = '';
      if (!element.clientWidth) return;
      const style = getComputedStyle(element);
      const contentStyle = getComputedStyle(element.firstElementChild ?? element);
      const available =
        element.clientWidth - parseFloat(contentStyle.paddingLeft) - parseFloat(contentStyle.paddingRight) - 1;
      if (available <= 0) return;

      const measure = document.createElement('span');
      measure.style.position = 'fixed';
      measure.style.visibility = 'hidden';
      measure.style.whiteSpace = 'pre';
      measure.style.font = style.font;
      element.appendChild(measure);
      const width = name.split(/\s+/u).reduce((maximum, word) => {
        measure.textContent = word;
        return Math.max(maximum, measure.getBoundingClientRect().width);
      }, 0);
      measure.remove();
      if (width > available) {
        element.style.fontSize = `${(parseFloat(style.fontSize) * available) / width}px`;
      }
    }

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [name]);

  return (
    <h3 ref={heading} className="tier-name">
      {children ?? name}
    </h3>
  );
}
