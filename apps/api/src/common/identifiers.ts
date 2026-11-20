// PostgreSQL UUID columns reject arbitrary strings. Public routes commonly
// accept either a UUID or a human-readable slug, so callers must only place a
// value into a UUID predicate after this validation.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
