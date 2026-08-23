import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobFlowAppService } from './app-service.js';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
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
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid JSON body'), { statusCode: 400 }); }
}

async function staticFile(pathname, res) {
  const relative = normalize(pathname === '/' ? 'index.html' : pathname.slice(1)).replace(/^(\.\.(\/|\\|$))+/, '');
  const path = join(publicRoot, relative);
  if (!path.startsWith(publicRoot)) return false;
  try {
    const content = await readFile(path);
    res.writeHead(200, { 'content-type': contentTypes[extname(path)] ?? 'application/octet-stream', 'content-length': content.length });
    res.end(content);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function createJobFlowHandler({ service = new JobFlowAppService() } = {}) {
  await service.init();
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'jobflow' });
      if (req.method === 'GET' && url.pathname === '/api/dashboard') return json(res, 200, service.dashboard());
      if (req.method === 'POST' && url.pathname === '/api/receptionist') return json(res, 200, await service.receptionistTurn(await body(req)));
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && await staticFile(url.pathname, res)) return;
      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      return json(res, error.statusCode ?? 400, { error: error.message ?? 'request_failed' });
    }
  };
}
