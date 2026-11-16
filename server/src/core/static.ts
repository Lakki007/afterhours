import { existsSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { notFound } from './errors';

const NO_CACHE = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'registerSW.js']);

export function cacheControlFor(filePath: string): string {
  const name = basename(filePath);
  if (NO_CACHE.has(name)) return 'no-cache';
  // Vite emits content-hashed files into /assets: safe to cache forever.
  if (filePath.includes(`${sep}assets${sep}`) || filePath.includes('/assets/')) return 'public, max-age=31536000, immutable';
  // Icons, logos, robots: stable names, modest cache.
  return 'public, max-age=86400';
}

/**
 * Serve the built web app (production). Unknown non-file GETs fall back to
 * index.html so client-side routes like /admin/kits deep-link correctly.
 */
export async function registerStatic(app: FastifyInstance, webDist: string) {
  const root = resolve(webDist);
  if (!existsSync(resolve(root, 'index.html'))) {
    app.log.warn({ root }, 'WEB_DIST has no index.html; not serving the web app');
    return;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    wildcard: true,
    cacheControl: false,
    etag: true,
    lastModified: true,
    setHeaders(reply, filePath) {
      void reply.header('cache-control', cacheControlFor(filePath));
      if (basename(filePath) === 'sw.js') void reply.header('service-worker-allowed', '/');
    },
  });

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    const last = path.split('/').pop() ?? '';
    if (req.method !== 'GET' || path.startsWith('/api/') || path === '/api' || last.includes('.')) {
      throw notFound();
    }
    void reply.header('cache-control', 'no-cache');
    return reply.sendFile('index.html');
  });
}
