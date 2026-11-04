/**
 * Minimal protection for endpoints that write data or spend LLM credits.
 * - If ADMIN_TOKEN is unset (local dev), everything is allowed.
 * - Otherwise the caller must send `x-admin-token: <ADMIN_TOKEN>`,
 *   or Vercel Cron's `authorization: Bearer <CRON_SECRET>`.
 */
export function isAuthorized(req: Request): boolean {
  const admin = process.env.ADMIN_TOKEN;
  if (!admin) return true;
  if (req.headers.get("x-admin-token") === admin) return true;
  const cron = process.env.CRON_SECRET;
  return Boolean(cron) && req.headers.get("authorization") === `Bearer ${cron}`;
}
