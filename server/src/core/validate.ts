import type { z } from 'zod';
import { HttpError, zodIssues } from './errors';

/**
 * Validate untrusted input against a shared schema. Throws a 400 in the
 * shared error shape. Use for body, query and params alike:
 *   const body = parse(SendReactionRequestSchema, req.body);
 */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issues = zodIssues(r.error);
  throw new HttpError(400, 'bad_request', issues[0]?.message ?? 'Invalid input.', { issues });
}
