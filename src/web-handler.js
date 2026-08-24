import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobFlowAppService } from './app-service.js';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function requestId(req) {
  const candidate = req.headers['x-request-id'];
  return typeof candidate === 'string' && candidate.length <= 128 ? candidate : randomUUID();
}

function applySecurityHeaders(res, id) {
  res.setHeader('x-request-id', id);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'");
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error('request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON body must be an object');
    }
    return parsed;
  } catch (error) {
    if (error?.statusCode) throw error;
    throw Object.assign(new Error('invalid JSON body'), { statusCode: 400 });
  }
}

async function staticFile(pathname, res) {
  const relative = normalize(pathname === '/' ? 'index.html' : pathname.slice(1)).replace(/^(\.\.(\/|\\|$))+/, '');
  const path = join(publicRoot, relative);
  if (!path.startsWith(publicRoot)) return false;
  try {
    const content = await readFile(path);
    res.writeHead(200, {
      'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
      'content-length': content.length,
      'cache-control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(content);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function suppliedApiKey(req) {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  const direct = req.headers['x-api-key'];
  return typeof direct === 'string' ? direct.trim() : '';
}

function createRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const buckets = new Map();
  return {
    consume(key, now = Date.now()) {
      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
      }
      current.count += 1;
      if (current.count > max) return { allowed: false, remaining: 0, resetAt: current.resetAt };
      return { allowed: true, remaining: max - current.count, resetAt: current.resetAt };
    },
  };
}

function pathMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

export async function createJobFlowHandler({
  service = new JobFlowAppService(),
  apiKey = process.env.JOBFLOW_API_KEY ?? '',
  requireAuth = process.env.NODE_ENV === 'production',
  rateLimitWindowMs = Number(process.env.JOBFLOW_RATE_LIMIT_WINDOW_MS ?? 60_000),
  rateLimitMax = Number(process.env.JOBFLOW_RATE_LIMIT_MAX ?? 120),
} = {}) {
  if (requireAuth && !apiKey) throw new Error('JOBFLOW_API_KEY is required in production.');
  if (!Number.isFinite(rateLimitWindowMs) || rateLimitWindowMs <= 0) throw new Error('Invalid JobFlow rate-limit window.');
  if (!Number.isInteger(rateLimitMax) || rateLimitMax <= 0) throw new Error('Invalid JobFlow rate-limit maximum.');

  await service.init();
  let ready = true;
  const limiter = createRateLimiter({ windowMs: rateLimitWindowMs, max: rateLimitMax });

  return async function handler(req, res) {
    const id = requestId(req);
    applySecurityHeaders(res, id);
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/health/live')) {
        return json(res, 200, { ok: true, service: 'jobflow', status: 'live', requestId: id });
      }
      if (req.method === 'GET' && url.pathname === '/health/ready') {
        return json(res, ready ? 200 : 503, { ok: ready, service: 'jobflow', status: ready ? 'ready' : 'not_ready', requestId: id });
      }

      if (url.pathname.startsWith('/api/')) {
        const remote = req.socket?.remoteAddress ?? 'unknown';
        const rate = limiter.consume(remote);
        res.setHeader('x-ratelimit-remaining', String(rate.remaining));
        res.setHeader('x-ratelimit-reset', String(Math.ceil(rate.resetAt / 1000)));
        if (!rate.allowed) return json(res, 429, { error: 'rate_limited', requestId: id });

        if ((requireAuth || apiKey) && !secureEqual(suppliedApiKey(req), apiKey)) {
          res.setHeader('www-authenticate', 'Bearer realm="JobFlow"');
          return json(res, 401, { error: 'unauthorized', requestId: id });
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/dashboard') return json(res, 200, service.dashboard());
      if (req.method === 'POST' && url.pathname === '/api/receptionist') return json(res, 200, await service.receptionistTurn(await body(req)));
      if (req.method === 'POST' && url.pathname === '/api/leads') return json(res, 201, await service.captureLead(await body(req)));

      let match = pathMatch(url.pathname, /^\/api\/leads\/([^/]+)\/qualify$/);
      if (req.method === 'POST' && match) return json(res, 200, await service.qualifyLead(match[0], await body(req)));

      match = pathMatch(url.pathname, /^\/api\/leads\/([^/]+)\/customer$/);
      if (req.method === 'POST' && match) return json(res, 201, await service.createCustomerFromLead(match[0]));

      if (req.method === 'POST' && url.pathname === '/api/appointments') return json(res, 201, await service.scheduleAppointment(await body(req)));

      match = pathMatch(url.pathname, /^\/api\/appointments\/([^/]+)\/status$/);
      if (req.method === 'POST' && match) {
        const input = await body(req);
        if (typeof input.status !== 'string' || !input.status) throw Object.assign(new Error('status is required'), { statusCode: 400 });
        const { status, ...details } = input;
        return json(res, 200, await service.transitionAppointment(match[0], status, details));
      }

      if (req.method === 'POST' && url.pathname === '/api/payments') return json(res, 201, await service.recordPayment(await body(req)));
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && await staticFile(url.pathname, res)) return;
      return json(res, 404, { error: 'not_found', requestId: id });
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      if (status >= 500) ready = false;
      return json(res, status, { error: error?.message ?? 'request_failed', requestId: id });
    }
  };
}
