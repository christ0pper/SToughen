/**
 * What a server action hands back to the form that called it.
 *
 * `fail` is the interesting half. An action can go wrong two ways, and they
 * deserve different treatment:
 *
 *   - The app itself said no: not signed in, not an Admin, the period is
 *     locked, the period is not ready. Those messages are written for the
 *     person reading them and are shown as they are.
 *   - Something broke: a constraint, a bad query, a file that would not read.
 *     Those messages are written for whoever maintains this. Showing them puts
 *     database internals on screen - a real upload once failed with
 *     "Invalid `prisma.auditLog.create()` invocation: Foreign key constraint
 *     violated", which tells the person at the keyboard nothing they can act
 *     on. The detail goes to the server log; the screen gets a sentence.
 */

export interface ActionStat {
  label: string;
  value: string;
  /** Draws attention to a figure that means work is still outstanding. */
  tone?: 'brand' | 'warn';
}

export interface ActionState {
  error?: string;
  message?: string;
  /**
   * Headline figures for what just happened, shown as chips beside the message.
   * For an import, "did it read my file properly" is answered by numbers, not
   * by a sentence saying it worked.
   */
  stats?: ActionStat[];
}

/**
 * Errors the app raises on purpose, matched by name so that the two separate
 * PeriodLockedError classes both count without importing either.
 */
const EXPECTED_ERRORS = new Set([
  'UnauthorizedError',
  'ForbiddenError',
  'PeriodLockedError',
  'NotReadyError',
]);

export const ok = (message: string, stats?: ActionStat[]): ActionState => ({ message, stats });

export const fail = (error: unknown): ActionState => {
  if (error instanceof Error && EXPECTED_ERRORS.has(error.name)) {
    return { error: error.message };
  }

  console.error('[action failed]', error);
  return {
    error:
      'Something went wrong on the server and the change was not saved. ' +
      'The details are in the server log.',
  };
};
