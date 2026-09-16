/**
 * What a deployment needs before anyone can sign in, and how to say so.
 *
 * On a server that runs from a local `.env`, a missing setting shows up the
 * first time you start it. On a hosted deployment it shows up as a blank 500:
 * a server action that throws returns nothing the browser can display, so the
 * sign-in screen fails with no explanation anywhere the person can see it.
 * That happened on Vercel, where `.env` is not deployed and the settings have
 * to be entered again in the dashboard.
 *
 * So the login screen checks its own configuration and says which setting is
 * missing. Names only - never a value, and never a connection string.
 */

/**
 * Settings with no working default, each described as a phrase that can be read
 * straight out on screen.
 */
export function settingProblems(): string[] {
  const problems: string[] = [];

  const url = process.env.DATABASE_URL?.trim() ?? '';
  if (!url) problems.push('DATABASE_URL is not set');
  // A value pasted straight out of a .env file keeps its quotes, and Prisma
  // then rejects it for not starting with a protocol.
  else if (/^["']/.test(url)) problems.push('DATABASE_URL has quotation marks around it - remove them');
  else if (!/^(postgres|postgresql):\/\//.test(url)) problems.push('DATABASE_URL does not start with postgresql://');

  const secret = process.env.SESSION_SECRET ?? '';
  if (!secret) problems.push('SESSION_SECRET is not set');
  else if (secret.length < 32) problems.push('SESSION_SECRET is shorter than 32 characters');

  return problems;
}

/**
 * Turns a failure from the database layer into a sentence for the sign-in
 * screen. Anything unrecognised stays generic - the detail goes to the log,
 * where it belongs, rather than onto a public page.
 */
export function describeSignInFailure(error: unknown): string {
  const problems = settingProblems();
  if (problems.length > 0) {
    return `This deployment is not finished being set up:\n${problems.map((problem) => `• ${problem}`).join('\n')}\nAn administrator fixes these where the site is hosted, then redeploys.`;
  }

  const text = String((error as { message?: string })?.message ?? error);

  if (/must start with the protocol|invalid .*connection string|Error parsing connection string/i.test(text)) {
    return 'The database address in this deployment is not a valid connection string. Check DATABASE_URL in the hosting dashboard - a value copied from a .env file keeps its quotation marks, which is the usual cause.';
  }
  if (/Authentication failed|password authentication/i.test(text)) {
    return 'The database rejected the password in this deployment. Check DATABASE_URL in the hosting dashboard.';
  }
  if (/P1001|Can't reach database server|ETIMEDOUT|ECONNREFUSED/i.test(text)) {
    return 'The database did not answer. It may be paused in Supabase, or the address in DATABASE_URL may be wrong.';
  }
  if (/Max client connections reached|too many connections|P2037/i.test(text)) {
    return 'The database is out of free connections. Lower connection_limit in DATABASE_URL, or wait a moment and try again.';
  }
  if (/Query Engine|libquery_engine|PrismaClientInitializationError/i.test(text)) {
    return 'The database client failed to start on the server. The deployment log has the detail.';
  }

  return 'Sign-in could not be completed because of a problem on the server. The deployment log has the detail.';
}
