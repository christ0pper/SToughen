# Payroll

Internal payroll system for a single company. Ingests the monthly biometric
punch-clock export, calculates worked hours against the company's own shift,
break and rounding rules, surfaces everything ambiguous for human judgement, and
produces payslips and a summary report.

Admin-only tool. No employee self-service, no bank integration, no accounting
integration.

## Getting started

```bash
npm install
npx prisma db push      # creates prisma/payroll.db
npm run db:seed         # creates one Admin account and nothing else
npm run dev
```

The database starts empty. There are no sample employees and no sample
attendance: everyone on the payroll arrives either from the Employees tab or
from matching a block in your first real export. A sample employee that reaches
production is a person nobody hired, being paid.

Sign in at http://localhost:3000 as `123` / `123`. The username is matched as a
plain string, so it does not have to be an email address.

**`123` / `123` is a development convenience and nothing else.** Set a real
credential before this holds anyone's pay, and before the machine is reachable
on the network:

```bash
ADMIN_EMAIL=you@company.local ADMIN_PASSWORD='...' npm run db:seed
```

Also set a real `SESSION_SECRET` in `.env` before this touches real data. More
accounts are created in the app, under Settings → Accounts, where the 12-character
minimum still applies.

### Skipping sign-in while building

Put `AUTH_DISABLED=true` in `.env` and every visitor is treated as the first
Admin. Three things stop that reaching anyone else:

- `.env` is gitignored, so it cannot be committed.
- It is ignored when `NODE_ENV=production`, so a real build always asks for a
  password whatever `.env` says.
- Every screen carries a red banner while it is on, and `npm run preflight`
  fails.

**Run `npm run preflight` before pushing or deploying.** It checks the switches
that are fine locally and dangerous anywhere else — the bypass, the placeholder
`SESSION_SECRET`, guessable passwords — and exits non-zero so it can gate a hook
or CI. See `.env.example` for every variable.

Then walk the monthly cycle: add your employees with their device IDs, create a
period, upload that month's export, and work down the numbered sections on the
period screen.

## Running it for the office

One server on one PC, reached from phones on the same network. The phone renders
from the PC and holds no copy of anything, so a file uploaded on the PC is on the
phone at the next refresh — there is nothing to sync, and no second database.

```bash
npm run build
npm run start:lan     # same as start, but listening on the network
npm run lan           # prints the address to open on the phone
```

`npm run lan` also checks the two things that silently stop it working: a missing
Windows Firewall rule for the port, and `AUTH_DISABLED` still being set.

On the phone, open that address and use **Add to Home Screen** — it then launches
full screen with no address bar.

### From anywhere, not just the office Wi-Fi

A Cloudflare Tunnel puts a permanent HTTPS address in front of the PC, with
Cloudflare Access checking identity before any request reaches payroll data. No
router port is opened. See **[docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md)** —
the application side is already verified through a tunnel; what remains is
Cloudflare account setup.

Run `npm run preflight` first. It refuses while the sign-in bypass is on, the
session secret is the placeholder, or a password is guessable — all three of
which are survivable on your desk and not on the internet.

**What plain HTTP on the LAN costs you.** Next never terminates TLS itself, so a
direct `http://192.168.x.x:3000` connection sends the password and the session
cookie readable by anything else on that network. On a trusted office network
that is usually accepted. Putting a TLS proxy in front removes it, and the
session cookie marks itself `Secure` automatically once `x-forwarded-proto` says
https — so no code change is needed when you do.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | 93 tests over the calculation engine, parser and analytics |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:seed` | Create the Admin account if it is missing |
| `npm run db:studio` | Browse the database |
| `npm run reset -- --yes` | Delete every employee, period and audit entry, keeping accounts |
| `npm run preflight` | Check nothing unsafe is switched on before pushing or deploying |
| `npm run start:lan` | Production server, listening on the local network |
| `npm run lan` | Print the phone address, and check the firewall and auth bypass |
| `npm run smoke -- <export.xls>` | Parse → import → calculate → print, against a real export |
| `npm run compare-grace -- <export.xls>` | Measure the review-queue impact of the two rounding readings |

`smoke` and `reset` both write to whatever `DATABASE_URL` points at. Point them
at a scratch copy, not live payroll:

```bash
DATABASE_URL="file:./scratch.db" npx prisma db push
DATABASE_URL="file:./scratch.db" npm run smoke -- "C:/exports/july.xls"
```

## Architecture

```
src/
  domain/          Pure calculation. No database, no framework, fully unit-tested.
    config.ts        Every business rule as data - schedules, breaks, rates, rounding
    time.ts          Minute-of-day arithmetic; local-date formatting
    hours.ts         Punch -> payable duration, and the flagging rules
    pay.ts           Base -> gross -> ESI/PF -> net -> final
  import/
    parseBiometricXls.ts   The .xls reader
  services/        Database orchestration
    importService    File -> period, attendance rows, the two review queues
    payrollService   Assemble inputs, run the engine, snapshot PayrollLine
    periodService    Lock / reopen / readiness
    reportService    Payslip and summary data
    analyticsService History for the dashboard - confirmed metrics only
  actions/         Server actions, with permission checks and audit logging
  app/             Screens and the two export routes
  components/
    charts/          Inline-SVG charts: line, stacked bar, stat tile, comparison
  lib/             Database, auth, audit, formatting, Excel and PDF export
```

The design rule that matters: **`src/domain/` knows nothing about the database
or the framework.** It takes plain values and returns plain values, which is why
the rules can be tested exhaustively and why recalculating a period years later
reproduces the original figures from the stored inputs.

Nothing anywhere reads the device's own `Duration`, `Late By`, `Early By`, `OT`
or `Shift` columns. They are captured verbatim for audit and never enter a
calculation — the device's shift template does not match this company's policies,
and the real July export confirms it mislabels night shifts as `GS`.

## Business rules

All in `src/domain/config.ts`, as data rather than scattered through the code.
The Settings screen displays the values currently in force.

Read **[docs/RULE-DECISIONS.md](docs/RULE-DECISIONS.md)** before changing
anything. It lists all eighteen places where the spec was ambiguous or silent,
what the code does, and how to change it.

The two that were open questions are now the owner's to set, in the app rather
than in code:

1. **The rounding grace** (decision 1) — Settings → Punch rounding grace. How
   much lateness is absorbed before it docks pay and flags the day. On measured
   data, 0 minutes flags 69% of days against 7% at 30 minutes; run
   `npm run compare-grace` against a real export to measure your own.
2. **ESI/PF for exception roles** (decision 6) — a per-employee checkbox.
   Workers default on, managers and drivers default off per spec 12.11, and
   either can be overridden for an individual.

## Design

Drawn from the [BIPAY payroll design system](https://www.figma.com/community/file/1223187087316926937/bipay-payroll-management-system-dashboard-design-system).
Three rules carry the look, and they are what to preserve if any of it is
retuned:

1. **Quiet chrome, loud numbers.** White surfaces on light grey, a hairline
   edge, almost no shadow. The colour budget goes on figures and status, not on
   containers.
2. **Blue accents, near-black commits.** Blue marks links, the active tab,
   progress and emphasis numerals; the button that commits a form is near-black,
   so "save" never competes with "this is the important number".
3. **Tight radii.** 8px cards, 6px controls. This is a working tool, not a
   consumer app.

Tokens live in `src/app/globals.css`; nothing hard-codes a hex outside that file
and `src/components/charts/tokens.ts`. Green is reserved for meaning — "active",
"locked", a positive delta — and is never brand.

Two of its frames are built out rather than just borrowed from:

| Frame | Where it lives | What fills it |
|---|---|---|
| Headline strip, log panel, announcements | **Dashboard** | `KpiStrip` shows four figures with the two parts each divides into; the log panel becomes day counts plus hour meters, all drawn against total payable hours so their lengths compare; announcements becomes the last six audit entries |
| Profile rail, tabs, stepped bars, stat strip | **Employee** | `ProfileRail` holds identity and pay, `Tabs` carries Overview / Pay history / Rates / Deductions / Extras / Master data, and `BarBreakdown` steps worked, punctual, leave and absent days |

Nothing in either is placeholder: every figure comes from `PeriodTrendPoint` or
the employee's own payroll lines. Where the source frame showed a metric this
payroll has no equivalent for — geolocated punches, leave allowances — the panel
carries the nearest real one instead of an invented number. Exception-role staff
have no punch discipline to measure, so their bars drop the punctuality split
rather than showing a truthful-looking zero.

Two deliberate departures from the template:

- Its status pills set white on gold, which measures 2.2:1. Ours keeps the gold
  fill and takes dark ink instead — same shape, actually readable. Every solid
  pill here clears 4.5:1 for its own text.
- `ActionForm` picks its button weight from whether the form has fields: a form
  that commits something gets the near-black button, a bare one-button row
  action stays quiet. A form whose children are only prose has to say so
  (`variant="default"`) — see "Ignore this block" on a payroll period.
- `BarBreakdown` gives a non-zero bar a floor height so its label fits inside it,
  but draws a real zero as no bar at all. A zero shrunk to "very short" reads as
  a small amount rather than none.

The three chart hues are validated, not chosen by eye:

```
node scripts/validate_palette.js "#2563eb,#eb6834,#1baf7a"      --mode light --surface "#ffffff" --pairs all
```

All checks pass (worst CVD ΔE 9.2, worst normal-vision ΔE 27.6). Teal sits
below 3:1 against white, which obliges every chart using it to ship a legend and
a table view — they all do. Re-run that command before changing a series colour
or adding a fourth. The restyle left these untouched: the series are blue-led
already, and they are still drawn on white.

## Stack

Next.js 15 · TypeScript · SQLite via Prisma · SheetJS · pdfmake · Vitest.

SQLite is deliberate: one company, ~110 employees, one batch a month, and a
requirement to keep history indefinitely. The whole database is one file, so
backup is a file copy. Moving to Postgres is a `provider` change in
`prisma/schema.prisma` plus a migration — no application code depends on the
engine.

## What is built

- Employee master data with append-only hourly-rate history
- Monthly `.xls` import: every sheet, day columns located by header text,
  Device ID matching, unmatched-row queue, zero-punch reconciliation
- Hour calculation engine for OS / PS / NS including midnight-crossing shifts
- Manual hour entry for exception roles
- Discrepancy flagging and resolution: leave tags, paid/unpaid, partial-day,
  manual durations, overtime confirmation, punctuality override with note
- Punctuality, merit, public holiday and discretionary bonuses
- ESI and PF as a per-employee opt-in, with a configurable threshold warning and
  no assumed statutory figure
- Admin-configurable punch rounding grace, set in the app rather than in code
- One-off and recurring deductions
- Approval and locking (Admin), reopen-for-correction, field-level audit trail
- Payslips as PDF (all, or one employee) and the summary report as Excel
- Two-tier permissions with field-level restrictions on rate and bank details
- Analytics dashboard: payroll cost, hours, punctuality trend, leave breakdown,
  deductions, and a sortable cross-employee comparison — plus per-employee
  history charts on the employee screen
- Filterable audit trail across every period
- Account management (Admin): add accounts, change name/email/role, reset
  passwords, disable, delete; plus self-service password change for everyone
- Employee records fully editable, including joining date and employee code,
  with removal guarded so payroll history is never destroyed

## What is not built

- **Analytics metrics beyond the confirmed set.** The dashboard covers exactly
  what the spec confirms. Sections 23 and 27 record that the wider list
  ("whatever else is useful in payroll software used by other companies") is
  unscoped and must not be invented without a scoping conversation — so it has
  not been. Adding one is a deliberate act: extend `PayrollResult`, add the
  column to `PayrollLine`, surface it.
- **Password reset by email, MFA, SSO.** An Admin sets passwords directly. The
  spec leaves the auth mechanism open; what is here is deliberately minimal and
  replaceable.
- **Employee photographs, document attachments, leave balances/accrual.** Not in
  the spec.

## Where things are changed

| Screen | What it does |
|---|---|
| **Employees** | the directory, with **Add employee** top-right; opening anyone raises a dialog over the list holding their master data, totals, rates, deductions, bonuses and pay history |
| **Settings → General** | rounding grace, ESI threshold, public holidays, your own password |
| **Settings → Accounts** | app accounts: names, emails, roles, passwords, enable/disable, delete |
| **Payroll periods** | the monthly run — import, the two review queues, flagged days, merit, exception-role hours, approval |

Settings holds what is company-wide: the calculation rules, the holiday
calendar and who can sign in. Anything about a *person* lives on the Employees
tab, next to the list they came from.

One employee record is rendered by `EmployeeDetail`, and reached two ways: the
directory's links are caught by the intercepting route
`employees/@modal/(.)[id]`, which shows it in a dialog without losing the list,
while a bookmark or refresh of `/employees/[id]` renders the same component as a
full page. Neither can drift from the other, because there is only one of them.

## Removing things

A period is a **draft** until somebody approves it. Draft totals move every time
a queue item is cleared, so nothing outside the period screen counts them: the
dashboard reports approved periods only and lists the drafts still waiting.
Approving recalculates, locks the figures and is what makes them quotable.

Joining date is **optional**. A punch file carries a device ID and a name and
nothing else, and inventing a first day to satisfy a form is worse than
recording that nobody knows it yet. Only holiday pay depends on it — 365 days of
tenure — and tenure nobody has recorded is treated as not qualifying rather than
guessed. That withholding is visible: it is flagged on the employee, in the
directory, and blocks approval when a public holiday actually falls in the
period.

Payroll is a record, so deletion is deliberately narrower than editing:
**everything is editable, but not everything is deletable.**

| Thing | Edit | Remove |
|---|---|---|
| Account | name, email, role, password, enabled | deleted only while it has no recorded activity — otherwise disable it |
| Employee | every field, including joining date and code | deleted only while they have no payroll history — otherwise set Left / inactive |
| Rate row | append a new rate any time | removable, unless it is the only rate on record |
| Deduction | — | stop (recurring) or delete outright |
| Extra / bonus | — | removable |
| Holiday | — | removable |

The two guards exist for a reason:

- Deleting an **account** would blank the "who" on every audit entry and payroll
  approval it is attached to. Disabling stops them signing in and keeps the
  trail intact (spec 19).
- Deleting an **employee** cascades their attendance and payroll history away
  with them — in one measured month that was 181 attendance days and 6 calculated
  periods for one person. Spec 21 requires that history be kept indefinitely,
  so "Left / inactive" is the route for a real leaver.

Both refuse with an explanation naming the safe alternative, rather than
silently doing damage. Deletion stays available for records created in error.

## Testing

84 tests, all on the parts where a mistake means someone is paid the wrong
amount:

- **`tests/hours.test.ts`** — every schedule, both rounding directions and both
  grace settings, break overlap edges, midnight crossing, each flag, and each
  resolution path
- **`tests/pay.test.ts`** — the full formula chain, the PF cap, holiday tenure to
  the day, mid-month rate changes, exception roles, and the review gates
- **`tests/parse.test.ts`** — a synthetic workbook built to the real layout,
  round-tripped through the actual legacy BIFF8 `.xls` format
- **`tests/analytics.test.ts`** — leave counting per resolution tag, and the
  punctuality-rate definition

The tests found two real bugs during the build: confirming overtime silently
killed the punctuality bonus, and every calendar date was rendering a day early
in any timezone east of Greenwich. Rendering the dashboard and looking at it
found three more that the build and typecheck both passed: formatter functions
being passed across the server/client boundary (which broke every chart at
runtime), exception roles reporting 0% punctuality instead of "not applicable",
and axis ticks reading 38 / 75 / 113.
#   S T o u g h e n  
 