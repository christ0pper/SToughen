/**
 * Turns audit-log rows into something a person can read.
 *
 * The log stores values the way the code produced them - JSON blobs and Prisma
 * model names. Those are fine on disk and useless on screen, so they are
 * translated here rather than shown raw.
 */

const ENTITY_LABELS: Record<string, string> = {
  PayrollPeriod: 'Payroll period',
  ImportBatch: 'File import',
  AttendanceDay: 'Attendance day',
  Employee: 'Employee',
  EmployeeRate: 'Hourly rate',
  Deduction: 'Deduction',
  ExtraBonus: 'Extra / bonus',
  ZeroPunchReview: 'Zero-punch review',
  UnmatchedBlock: 'Unmatched row',
  Holiday: 'Holiday',
  Setting: 'Setting',
  User: 'Account',
};

export function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

/** "totalFinalPay" -> "Total final pay" */
function humaniseKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function humaniseScalar(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString('en-IN')
      : value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

/**
 * A stored value as a sentence. JSON objects become "Key: value" pairs;
 * anything else is passed through.
 */
export function auditValue(raw: string | null): string {
  if (raw == null || raw === '') return '—';

  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed;

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map(humaniseScalar).join(', ');
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => `${humaniseKey(key)}: ${humaniseScalar(value)}`)
        .join(' · ');
    }
    return humaniseScalar(parsed);
  } catch {
    return trimmed;
  }
}

/** Who did it. Seeded and scripted rows have no user attached. */
export function actorLabel(name: string | null | undefined): string {
  return name ?? 'System';
}

/** Every action the audit filter can offer, in the order it offers them. */
export const ACTION_LABELS: Record<string, string> = {
  PERIOD_CREATE: 'Period created',
  PERIOD_LOCK: 'Period locked',
  PERIOD_REOPEN: 'Period reopened',
  PERIOD_RECALCULATE: 'Recalculated',
  IMPORT: 'File imported',
  FIELD_UPDATE: 'Field changed',
  RESOLVE_FLAG: 'Flag resolved',
  ZERO_PUNCH_DECISION: 'Zero-punch decision',
  UNMATCHED_RESOLVE: 'Unmatched row resolved',
  RATE_CHANGE: 'Rate changed',
  DEDUCTION_CREATE: 'Deduction added',
  DEDUCTION_STOP: 'Deduction stopped',
  EXTRA_CREATE: 'Extra added',
  EMPLOYEE_CREATE: 'Employee created',
  HOLIDAY_CHANGE: 'Holiday changed',
  SETTING_CHANGE: 'Setting changed',
};

/** The actions worth flagging in a list that is mostly routine. */
export const SIGNIFICANT_ACTIONS = new Set(['PERIOD_LOCK', 'PERIOD_REOPEN', 'RATE_CHANGE']);

/** Reads an action code as a person would say it. */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
