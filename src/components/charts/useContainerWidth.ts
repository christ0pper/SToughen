'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Measures the chart's container so the SVG viewBox can be set in real pixels.
 *
 * Without this the viewBox is a fixed width and the browser letterboxes it -
 * the plot floats in the middle of a wide card with dead space either side, and
 * every label is scaled by whatever ratio the letterboxing happened to pick.
 * Matching viewBox units to CSS pixels keeps the scale at 1:1, so 10px text is
 * 10px whether the card is full width or half.
 */
export function useContainerWidth(fallback = 720, minimum = 320) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = (value: number) => setWidth(Math.max(minimum, Math.round(value)));
    measure(element.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [minimum]);

  return [ref, width] as const;
}
