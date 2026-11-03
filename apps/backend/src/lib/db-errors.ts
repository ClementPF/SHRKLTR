/** True when err (or any error in its cause chain) is a Postgres unique violation on constraint. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  while (typeof current === 'object' && current !== null) {
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23505' && e.constraint_name === constraint) return true;
    current = e.cause;
  }
  return false;
}
