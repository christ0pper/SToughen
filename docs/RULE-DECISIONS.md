# Rule decisions

Every place the spec was silent, ambiguous, or self-contradictory, and what the
code does about it. Each entry says where the rule lives so it can be changed
without hunting.

The spec's own instruction is followed throughout: **silence means "not yet
decided", never "use the industry default."** Nothing here imports a
conventional payroll assumption. Where a choice had to be made to write code at
all, it is listed below for confirmation.

---

## 1. The 30-minute grace is only defined on one side — the big one

**Spec 12.3.** Bullets 1 and 2 grant an explicit 30-minute grace on the two
sides that would *add* hours: early arrival rounds up to shift start, late
departure rounds down to shift end. Bullet 3 then says "beyond that 30-minute
grace window in either direction (i.e. **early departure or late arrival**
beyond grace), actual punch time is used" — implying a grace on the two sides
that *reduce* hours, which the document never defines.

**Built:** strict — `lateArrivalGraceMinutes: 0`, `earlyDepartureGraceMinutes: 0`.
Any lateness or early departure reduces payable hours and therefore trips the
"not exactly 8 hours" flag. This matches the document's repeatedly stated intent
to surface everything for human judgement rather than absorb it silently.

**But measure it before committing.** `npm run compare-grace` runs the same
export through both readings. On the generated sample:

| Reading | Days flagged |
|---|---|
| Strict (grace 0 / 0) | 74 of 108 — **69%** |
| Lenient (grace 30 / 30) | 8 of 108 — **7%** |

Extrapolated to ~110 employees over a 27-working-day month, that is roughly
**2,000 flagged days a month versus 200**. The strict reading may well be
correct policy, but it is not a review queue anyone will work through. Run the
comparison against a real export before deciding.

**To change: Settings → Punch rounding grace.** The owner sets it in the app,
Admin-only, and it is audit-logged like any other setting change. No code
change, no redeploy, no `.env` edit.

Changing it does not rewrite history: a draft period picks the new value up on
its next recalculation, and a locked period keeps its approved figures until an
Admin reopens and recalculates it.

`.env` (`PAYROLL_LATE_ARRIVAL_GRACE_MINUTES` /
`PAYROLL_EARLY_DEPARTURE_GRACE_MINUTES`) still sets the *initial* value used
before the owner has saved one, which is how tests and
`npm run compare-grace` pin a value without touching the database.

`src/lib/settings.ts` → `getRoundingGrace`; `src/domain/hours.ts` →
`GraceMinutes`; `src/domain/config.ts` → `ROUNDING` for the fallback.

---

## 2. Very early arrival and very late departure

**Spec 12.3** defines rounding for punches *within* 30 minutes of the shift
boundary, and bullet 4 adds that a punch-out more than 30 minutes late is
"capped at scheduled shift end **regardless**". It says nothing about a
punch-in more than 30 minutes early.

**Built:** symmetrical with bullet 4 — early arrival is never credited at any
distance, exactly as late departure is never credited at any distance. Punching
in at 07:00 for a 09:00 shift counts from 09:00.

The alternative reading (bullet 3's "either direction" covering very-early
arrival, so actual time is used) would *credit* early arrival, contradicting
both bullet 1's "no early-arrival credit" and bullet 3's own "reducing payable
hours accordingly". It was rejected as internally inconsistent.

`src/domain/hours.ts` → `roundPunchIn` / `roundPunchOut`.

---

## 3. Overtime could never have been detected

**Spec 12.7** says overtime is "flagged via the standard 8-hour discrepancy
mechanism (excess hours ≠ 8)". But **spec 12.3** caps punch-out at shift end
regardless, so calculated hours can never exceed 8 from punches alone. Taken
together, overtime would be structurally invisible.

**Built:** a separate `POSSIBLE_OVERTIME` flag, raised when the *raw* punches
extend more than 30 minutes beyond the shift, even though pay stays capped at 8
hours. The day is surfaced with the uncredited minutes shown, and confirming
overtime adds them at the same hourly rate.

This is an addition to the spec, not an interpretation of it — flagged here
because it changes what appears in the review queue.

`src/domain/hours.ts` → `OVERTIME_REVIEW_THRESHOLD_MINUTES`.

---

## 4. Where inside each break window the break is taken

**Spec 12.2** gives windows (breakfast 09:00–11:00, lunch 12:00–14:00, tea
15:45–16:30) and says PS takes theirs in the first half and OS in the second —
explicitly "a rule-of-thumb assumption for deduction purposes, not a fixed,
enforced sub-slot". It does not pin exact times, but exact times are needed to
decide whether a break overlaps a partial day.

**Built:** the break sits at the start of its half.

| Break | Minutes | PS slot | OS slot |
|---|---|---|---|
| Breakfast | 15 | 09:00–09:15 | 10:00–10:15 |
| Lunch | 30 | 12:00–12:30 | 13:00–13:30 |
| Tea | 15 | 15:45–16:00 | 16:15–16:30 |

These reconcile exactly: OS 09:00–18:00 is 9 hours less 60 minutes of breaks =
8 hours. PS 08:00–17:00 likewise. NS takes no deduction and 22:00–06:00 is 8
hours flat. All three schedules land on the standard day, which is good evidence
the slot placement is right.

**Partial overlap** deducts only the overlapping minutes. Leaving at 13:10
deducts 10 of the 30 lunch minutes. A break the employee was never on site for
is not deducted at all, per the spec's own example.

`src/domain/config.ts` → `BREAKS`.

---

## 5. A resolved discrepancy stops blocking the punctuality bonus

**Spec 12.8** condition 3 is "has no **unresolved/unoverridden** discrepancy for
that day."

**Built:** literally. A flag blocks the bonus only while it is unresolved. Once
a reviewer actions the day — confirms the overtime, enters the duration, tags
the leave — the flag no longer blocks it on its own; the punch-time conditions
still have to hold.

This matters for confirmed overtime specifically: spec 12.7 says confirmed OT
"still counts toward that day's punctuality and merit eligibility", which is
only possible if resolving the day clears the block. An earlier build had this
wrong and the test caught it.

`src/domain/hours.ts` → `blockingDiscrepancy`.

---

## 6. Statutory deductions for exception roles

**Spec 12.11** annotates both ESI and PF with "not applicable to exception
roles". **Spec 14.3** puts ESI and PF flags on every employee record without
exception.

**RESOLVED — confirmed by the product owner.** 12.11 is the *default*, not a
hard rule. The employee's own ESI/PF flags are the single source of truth
(spec 14.3), and the engine no longer overrides them:

- Creating a punch-based worker defaults both boxes **on**.
- Creating an exception role (salesman, manager, security, driver) defaults
  both **off**, matching 12.11.
- Either box can be ticked or unticked for any individual — a driver who does
  carry PF, a worker who is exempt. Switching an existing employee's schedule
  re-suggests the default, but never overwrites a box a human has already set.

This keeps the doc's stated position as the out-of-the-box behaviour while
leaving the real-world exceptions to a human, rather than encoding a blanket
rule that could silently underpay statutory contributions.

`src/components/employees/StatutoryFields.tsx` for the defaults;
`src/domain/pay.ts` for the (now flag-only) calculation.

---

## 7. Punches appearing on a Sunday

**Spec 12.5** says Sunday is the only true weekly off and an unpunched Sunday is
not flagged. It says nothing about someone who *does* punch on a Sunday.

**Built:** hours are calculated and paid normally, and the day is flagged
`WORKED_ON_WEEKLY_OFF` so a human confirms it. No premium rate is applied —
the spec defines no Sunday premium, and inventing one would be exactly the kind
of conventional assumption the spec forbids.

`src/domain/hours.ts`.

---

## 8. Paid leave versus worked hours

**Spec 12.4** allows a leave instance to be marked paid, and leave can be
partial-day. It does not say whether paid leave hours count toward the
punctuality and merit bonuses, which are "per worked hour".

**Built:** paid leave is paid but is not worked. It adds to base pay and not to
the punctuality or merit basis. Confirmed overtime, by contrast, *does* count
toward both, per spec 12.7.

The day's arithmetic:

```
creditedWork = worked (or manual override) + confirmed overtime   -> bonus basis
payable      = creditedWork + paid leave                          -> base pay basis
```

`src/domain/hours.ts`, `src/domain/pay.ts`.

---

## 9. Locking a period with items outstanding

**Spec 26** records "a period cannot be locked while unresolved flags remain" as
an *assumption*, not a confirmed rule, and **spec 27** asks whether it should
block or merely warn.

**Built:** it warns and lists every blocker, and the Admin can lock anyway by
ticking an override and giving a reason. The reason goes into the audit trail.
Neither reading is foreclosed — flip `lockPeriod` to reject outright if the
answer comes back "block".

`src/services/periodService.ts` → `lockPeriod`, `checkReadiness`.

---

## 10. A reason when reopening a locked period

**Spec 26** lists this as desirable but unconfirmed.

**Built:** required. It costs the Admin one line and is the difference between
an audit trail that explains itself and one that does not. Drop the check in
`reopenPeriod` if it proves annoying.

---

## 11. Rate resolution is per day, not per period

**Spec 12.12** requires historical calculations to use the rate in force at the
time.

**Built:** base pay accumulates day by day at the rate in force on *that day*, so
a mid-month raise splits correctly and a recalculation years later reproduces
the original figure. An employee with no rate covering a day is paid zero for it
**and a warning is raised** — silently paying zero is how payroll bugs hide.

`src/domain/pay.ts` → `calculatePayroll`.

---

## 12. Re-importing does not overwrite human work

Not addressed by the spec, but unavoidable in practice — a corrected export
gets uploaded mid-review.

**Built:** re-import refreshes only the raw punch fields. Every resolution,
merit tick, manual duration, confirmed overtime and override recorded against a
day survives. A duplicate file (same SHA-256) is imported but warned about.

`src/services/importService.ts`.

---

## 13. Days missing from the export still exist

**Built:** a row is written for every calendar day of the period for every
matched employee, whether or not the file carried a column for it. A day the
export omitted would otherwise have no record to flag, and an absence would
vanish rather than surface.

`src/services/importService.ts`.

---

## 14. Dates are local, and never formatted through `toISOString()`

Dates are stored as local midnight. `toISOString()` converts to UTC and reports
the **previous day** in every timezone east of Greenwich, IST included — this
bug was live during development and showed a July period containing 30 June.

**Built:** `isoDate()` formats calendar dates in local time. Never reintroduce
`toISOString().slice(0, 10)` for a date.

The system assumes a stable server timezone. India observes no DST, so this is
safe if deployed there; note it if the server ever moves.

`src/domain/time.ts` → `isoDate`.

---

## 15. Currency symbol in PDFs

The bundled Roboto is not guaranteed to carry U+20B9 (₹), and a silently
missing glyph on a payslip is worse than plain ASCII.

**Built:** PDFs print `Rs. 1,234.56`. Screens and the Excel export use ₹.

`src/lib/exportPdf.ts`.

---

## 16. What the punctuality rate divides by

The spec confirms a "punctuality-rate trend over time" (11.17) but never defines
the denominator.

**Built:** on-time days as a share of days **actually worked**, not of calendar
days or of expected working days. A month of approved sick leave should not read
as a punctuality collapse, and an absent day contributes ₹0 to punctuality pay
either way, so it does not belong in the denominator.

**Exception roles return null, never 0%.** Salesmen, managers, security and
drivers cannot earn the punctuality bonus at all (spec 12.8), so a zero would
read as "terrible" when the truth is "not applicable". They are also excluded
from the company-wide denominator — otherwise hiring a driver would depress the
whole company's punctuality rate.

`src/services/analyticsService.ts` → `punctualityRate`.

---

## 17. What the dashboard does *not* measure

**Spec 23 and 27** record that the analytics metric list beyond the confirmed
set is open-ended ("whatever else is useful in payroll software used by other
companies") and explicitly must not be invented without a scoping conversation.

**Built:** exactly the confirmed set and nothing else — hours worked, days
worked, leave taken, penalties/deductions, punctuality trend over time, and
cross-employee comparison.

Leave is now counted per resolution tag (sanctioned / unauthorised / half-day /
other, plus paid-leave days) and snapshotted onto `PayrollLine` at calculation
time, so re-tagging a day inside a reopened period does not silently rewrite a
locked period's history.

Adding a metric is a deliberate act: extend `PayrollResult`, add the column to
`PayrollLine`, and surface it. It should follow the scoping conversation, not
precede it.

---

## 18. Password policy

**Spec 18 and 27** leave authentication entirely open.

**Built:** a 12-character minimum and nothing else. Composition rules
("one digit, one symbol") mostly produce `Password1!`, which is worse than a
long passphrase. An Admin creates accounts, sets passwords and disables them;
everyone can change their own after confirming the current one. The last active
Admin cannot be disabled, and nobody can disable themselves.

Password values are never written to the audit log — only the fact of a change
and who made it.

`src/actions/users.ts` → `MIN_PASSWORD_LENGTH`.

---

## 19. What the real export actually contains

Rules 1-18 were written against the spec. This one was written against a real
109-employee `WorkDurationReport` for July, and corrects the spec-only guesses
that file proved wrong.

### The layout

Two sheets, 43 columns, ~8,500 merged ranges. Per employee: an `Employee:` row
carrying `"<deviceId> : <NAME>"` and the device's own summary line, then eight
labelled rows — `Status`, `InTime`, `OutTime`, `Duration`, `Late By`,
`Early By`, `OT`, `Shift` — then a blank separator.

**Day columns are not contiguous.** July's 31 days land on columns 2, 3, 5, 6,
7, 8, 9, 10, 12, … with gaps at 4, 11, 16, 21, 25 and 32 where merged spacers
sit. Nothing but the header text (`"1 W"`, `"2 Th"`) says which column is which
day, so that is what is read. Never index by position.

### Parsed

| Signal | Rule |
|---|---|
| `Status` | `P`, `A`, `WO`, `WOP`, `½P` are all that appear. Carried through raw **and** normalised; the engine reinterprets them. |
| `InTime` / `OutTime` | The only punch data trusted. `H:MM` and `HH:MM` both occur. |
| `<deviceId> : <NAME>` | The match key. Device IDs run 1-999, non-contiguous, and were unique across both sheets. |
| Report date range | Read for the period suggestion. Always confirmed by the uploader. |

### Neglected

`Duration`, `Late By`, `Early By` and `OT` are captured verbatim for audit and
**never fed into a calculation**. They are the device's arithmetic against the
device's own roster, and this payroll pays against the schedule set on each
employee record. 147 `Duration` cells exceed 14 hours, which is what the
device's own pairing produces on a cross-midnight shift — reusing those figures
would import its mistakes.

`Shift` is captured but not mapped. The file carries `GS` (3117 cells), `Sam`
(186) and `NS` (76), which are the device's roster names, not this system's
`PS` / `OS` / `NS` / `EXCEPTION`. `GS` in particular covers both an 07:55 and a
09:05 start in the same file, so it cannot be mapped to a schedule without
inventing a fact. The import lists the codes it saw and leaves the decision with
whoever sets each employee's schedule.

**Worth acting on:** the six people on `Sam` punch in at a median of 06:00,
which no configured schedule starts at. Their late/early figures will be wrong
until a matching schedule exists in `src/domain/config.ts`.

### Three traps this file set, all now covered by tests

1. **The print stamp.** The header carries both `Jul 01 2026 To Jul 31 2026`
   and `Printed On : Aug 31 2026`. A July report is normally printed in August,
   so a loose month match picks August — the wrong period, silently. The print
   stamp is stripped before any date is read, and only rows above the first
   employee block are considered.

2. **Unnamed enrolments.** Devices 158 and 159 have no name stored, so the
   export prints `"158 : 158"`. The guard that rejects punch pairs (`"12 : 30"`)
   also rejected these, dropping two complete blocks with no warning. A name
   without letters is now accepted on a row carrying the `Employee:` label —
   where a punch pair can never appear — and the import says which IDs arrived
   unnamed so they can be matched to a person.

3. **The wrong month.** Only day numbers are imported, so a 31-day file loaded
   into a 30-day period would drop day 31 in silence. The import now warns when
   the file spans more days than the period holds, and when the header's month
   disagrees with the period chosen.

### What the data says about the review queues

Out of 3,379 employee-days: 194 marked `A` still carry a punch, 80 `WO` days
carry a punch, 189 have an `InTime` and no `OutTime`, and 590 punch out before
they punch in. None of these are parse failures — they are the real anomaly load
the flagged-day and unmatched queues exist to absorb. 46 enrolments recorded no
punch at all for the month.

`src/import/parseBiometricXls.ts`, `src/services/importService.ts`,
`tests/parse.test.ts` → "quirks of the real device export".

---

## 20. Fixed monthly salary

The spec pays everyone by the hour. The rate sheet dated 31.08.2026 showed that
is not true of the business: five people are on a fixed monthly salary
(24,300 to 68,500), typed into the sheet's hourly column. Entered as hourly,
one of them would have been paid about 1.3 crore for July.

**Built:** a pay entry is either hourly or a fixed monthly salary. The basis
lives on the dated rate row, not the employee, so moving someone between the
two is a change like any raise and older periods still calculate the way they
were paid. Whichever basis is in force on the last day of a month decides how
that month is paid.

**How a salary is paid:**

- **In full, whatever the punches say.** Attendance is not read. In the July
  file three of the five salaried staff punched zero times and a fourth once;
  reading unpunched days as absence would have paid four of them nothing.
- **Spread across the calendar days of the month**, so a mid-month start
  (joining date), exit (left-on date) or raise is prorated by the day. With no
  joining date recorded, the month is paid in full.
- **Nothing on top.** No overtime, punctuality, merit or public-holiday pay —
  the salary already covers them, and adding holiday pay would pay those days
  twice.
- **ESI and PF** still follow each person's own flags, on the salary.
- **Unpaid leave is a one-off deduction**, entered deliberately. The engine does
  not invent a loss-of-pay rule (divide by 30, by 26, or by working days — that
  is a company policy to choose, not a default to assume).

**Kept out of the review queues.** A salaried person's pay does not depend on
their punches, so their missing punches are not flagged and they never enter
zero-punch review. For July that took 139 flagged days out of the queue.

**Refused rather than guessed:**

- A month where pay switches between hourly and salaried: the salaried days are
  paid, and a warning says the hourly days need checking by hand.
- An hourly rate over 10,000 or a monthly salary under 1,000 is refused at entry
  with a sentence naming the box that was probably meant — the exact mistake the
  rate sheet made.

`src/domain/pay.ts` → `calculatePayroll` (the `SALARIED` branch),
`isSalariedFor`; `src/actions/employees.ts` → `readPay`;
`tests/pay.test.ts` → "fixed monthly salary".
