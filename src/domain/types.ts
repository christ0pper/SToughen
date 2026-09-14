import type { ScheduleCode, StatusCode, ExceptionRole } from './config';

export type FlagReason =
  /** Both punches present but worked time is not exactly 8 hours. */
  | 'NOT_STANDARD_DAY'
  /** Exactly one of in/out is present - never auto-resolved (spec 12.6). */
  | 'INCOMPLETE_PUNCH'
  /** An expected working day with no punch data at all. */
  | 'NO_PUNCH_ON_WORKING_DAY'
  /** Raw punches extend meaningfully past the shift; needs OT review (spec 12.7). */
  | 'POSSIBLE_OVERTIME'
  /** Punches exist on a Sunday, the company's only true weekly off. */
  | 'WORKED_ON_WEEKLY_OFF';

export type ResolutionTag =
  | 'SANCTIONED_LEAVE'
  | 'UNAUTHORIZED_ABSENCE'
  | 'HALF_DAY'
  | 'OTHER';

/** The human decisions layered on top of a computed day. */
export interface DayResolution {
  tag: ResolutionTag | null;
  /** Free text - required when tag is OTHER. */
  note: string | null;
  /** All leave is unpaid by default (spec 12.4). */
  paidLeaveMinutes: number;
  /** Manual duration for an incomplete punch; overrides the calculated value. */
  manualWorkedMinutes: number | null;
  /** Confirmed overtime, added to the day at the same hourly rate (spec 12.7). */
  confirmedOtMinutes: number;
  meritTicked: boolean;
  /** "Grant punctuality bonus despite discrepancy" - requires a note. */
  grantPunctualityOverride: boolean;
  punctualityOverrideNote: string | null;
  /** Set once a reviewer has actioned the flag. */
  resolved: boolean;
}

export const EMPTY_RESOLUTION: DayResolution = {
  tag: null,
  note: null,
  paidLeaveMinutes: 0,
  manualWorkedMinutes: null,
  confirmedOtMinutes: 0,
  meritTicked: false,
  grantPunctualityOverride: false,
  punctualityOverrideNote: null,
  resolved: false,
};

export interface DayInput {
  date: Date;
  status: StatusCode;
  /** Raw punch, minutes from midnight, exactly as exported. */
  rawIn: number | null;
  rawOut: number | null;
  isPublicHoliday?: boolean;
}

export interface BreakDeduction {
  key: string;
  label: string;
  minutes: number;
}

export interface DayComputation {
  date: Date;
  schedule: ScheduleCode;
  status: StatusCode;

  isWeeklyOff: boolean;
  isPublicHoliday: boolean;
  isExpectedWorkingDay: boolean;

  rawInMinutes: number | null;
  rawOutMinutes: number | null;
  effectiveInMinutes: number | null;
  effectiveOutMinutes: number | null;

  spanMinutes: number;
  breakDeductions: BreakDeduction[];
  breakMinutes: number;

  /** Straight from the punches, before any human override. */
  calculatedWorkedMinutes: number;
  /** After a manual duration override, if one was entered. */
  workedMinutes: number;
  confirmedOtMinutes: number;
  /** Worked + confirmed OT. The basis for punctuality and merit pay. */
  creditedWorkMinutes: number;
  paidLeaveMinutes: number;
  /** Credited work + paid leave. The basis for base pay. */
  payableMinutes: number;

  /** Time punched outside the shift that pay does not credit; the OT candidate. */
  earlyArrivalMinutes: number;
  lateDepartureMinutes: number;
  uncreditedMinutes: number;

  /** creditedWork - 480. Signed, for triaging the review queue by magnitude. */
  deviationMinutes: number;

  flags: FlagReason[];
  isFlagged: boolean;
  isResolved: boolean;
  needsManualDuration: boolean;
  /** The reviewer's categorisation, carried through so leave can be counted. */
  resolutionTag: ResolutionTag | null;

  punctualIn: boolean;
  punctualOut: boolean;
  punctualityAwarded: boolean;
  meritAwarded: boolean;
}

export type EmployeeKind =
  | { kind: 'PUNCH'; schedule: ScheduleCode }
  | { kind: 'EXCEPTION'; role: ExceptionRole; schedule: ScheduleCode };
