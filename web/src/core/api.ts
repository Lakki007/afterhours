/*
  Typed API client. Every call names the shared Zod schema of its response,
  so the data you get back is validated and typed from the same contract the
  server uses:

    const me = await api.get('/api/me', MeResponseSchema);
    await api.post('/api/reactions', { kind: 'fire' }, OkSchema);
*/
import { ApiErrorBodySchema } from '@afterhours/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number | undefined;
  readonly issues: { path: string; message: string }[] | undefined;
  constructor(status: number, code: string, message: string, extra: { retryAfter?: number; issues?: { path: string; message: string }[] } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = extra.retryAfter;
    this.issues = extra.issues;
  }
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<S extends z.ZodType>(method: Method, path: string, schema: S, body?: unknown, signal?: AbortSignal): Promise<z.output<S>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      // Fastify rejects content-type: application/json with an empty body, so
      // bodiless calls send no content-type at all. post/put/patch default to {}.
      headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'offline', "Can't reach the server. Wi-Fi being moody?");
  }
  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (!res.ok) {
    const parsed = ApiErrorBodySchema.safeParse(json);
    if (parsed.success) {
      const e = parsed.data.error;
      throw new ApiError(res.status, e.code, e.message, { retryAfter: e.retryAfter, issues: e.issues });
    }
    throw new ApiError(res.status, 'internal', `Server said ${res.status}. Try again in a sec.`);
  }
  const out = schema.safeParse(json);
  if (!out.success) {
    console.error('API response did not match schema', path, out.error.issues);
    throw new ApiError(res.status, 'bad_response', 'Got a weird reply from the server.');
  }
  return out.data;
}

export const api = {
  get: <S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal) => request('GET', path, schema, undefined, signal),
  /** `api.post('/api/hunt/start', undefined, Schema)` is fine: it sends {} so Fastify accepts it. */
  post: <S extends z.ZodType>(path: string, body: unknown, schema: S) => request('POST', path, schema, body ?? {}),
  put: <S extends z.ZodType>(path: string, body: unknown, schema: S) => request('PUT', path, schema, body ?? {}),
  patch: <S extends z.ZodType>(path: string, body: unknown, schema: S) => request('PATCH', path, schema, body ?? {}),
  del: <S extends z.ZodType>(path: string, schema: S) => request('DELETE', path, schema),
};
