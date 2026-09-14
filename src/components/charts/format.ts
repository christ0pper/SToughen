/**
 * Serializable value formats.
 *
 * Charts are client components, and a server component cannot hand a function
 * across that boundary — React rejects it at render time. So the pages pass a
 * format *name* and the chart resolves it here.
 */

import { hours, rupees } from '@/lib/format';
import { compactNumber } from './tokens';

export type ValueFormat = 'rupees' | 'rupeesCompact' | 'hours' | 'percent' | 'integer' | 'compact';

/** Formats that count discrete things, so their axis must step in whole units. */
export const INTEGER_FORMATS: ValueFormat[] = ['integer'];

export function formatValue(kind: ValueFormat, value: number): string {
  switch (kind) {
    case 'rupees':
      return rupees(value);
    case 'rupeesCompact':
      return `₹${compactNumber(value)}`;
    case 'hours':
      return hours(value);
    case 'percent':
      return `${value.toFixed(0)}%`;
    case 'integer':
      return String(Math.round(value));
    case 'compact':
    default:
      return compactNumber(value);
  }
}

export function formatter(kind: ValueFormat): (value: number) => string {
  return (value: number) => formatValue(kind, value);
}
