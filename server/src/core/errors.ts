import type { ApiErrorBody, ErrorCode } from '@afterhours/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Throw this from any route; the error handler turns it into the shared error shape. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode | (string & {});
  readonly retryAfter: number | undefined;
  readonly issues: { path: string; message: string }[] | undefined;
  constructor(
    status: number,
    code: ErrorCode | (string & {}),
    message: string,
    opts: { retryAfter?: number; issues?: { path: string; message: string }[] } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = opts.retryAfter;
    this.issues = opts.issues;
  }
}

export const badRequest = (msg = 'That request did not make sense.') => new HttpError(400, 'bad_request', msg);
export const unauthorized = (msg = 'Sign in first.') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Not for you, sorry.') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Nothing here.') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg);

export function zodIssues(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  let status = 500;
  const body: ApiErrorBody = { error: { code: 'internal', message: 'Something broke on our side. Try again in a sec.' } };

  if (err instanceof HttpError) {
    status = err.status;
    body.error = { code: err.code, message: err.message };
    if (err.retryAfter !== undefined) {
      body.error.retryAfter = err.retryAfter;
      void reply.header('retry-after', String(err.retryAfter));
    }
    if (err.issues) body.error.issues = err.issues;
  } else if (err instanceof ZodError) {
    status = 400;
    const issues = zodIssues(err);
    body.error = { code: 'bad_request', message: issues[0]?.message ?? 'Invalid input.', issues };
  } else if ('statusCode' in err && typeof err.statusCode === 'number' && err.statusCode < 500) {
    status = err.statusCode;
    body.error = { code: status === 404 ? 'not_found' : 'bad_request', message: err.message };
  }

  if (status >= 500) req.log.error({ err }, 'request failed');
  void reply.status(status).send(body);
}
