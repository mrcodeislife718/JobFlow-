import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import { createJobFlowHandler } from '../src/web-handler.js';

const servers = new Set();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
  servers.clear();
});

function fakeService() {
  return {
    async init() { return this; },
    dashboard() { return { revenue: { collected: 100 } }; },
    async receptionistTurn(input) { return { type: 'receptionist', input }; },
    async captureLead(input) { return { id: 'lead-1', ...input }; },
    async qualifyLead(id, input) { return { id, qualified: true, ...input }; },
    async createCustomerFromLead(id) { return { id: 'customer-1', sourceLeadId: id }; },
    async scheduleAppointment(input) { return { id: 'appointment-1', ...input }; },
    async transitionAppointment(id, status, details) { return { id, status, ...details }; },
    async recordPayment(input) { return { id: 'payment-1', ...input }; },
  };
}

async function listen(handler) {
  const server = createServer(handler);
  servers.add(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

test('production handler fails closed when API credentials are missing', async () => {
  await assert.rejects(
    createJobFlowHandler({ service: fakeService(), requireAuth: true, apiKey: '' }),
    /JOBFLOW_API_KEY is required/,
  );
});

test('health endpoints stay public while API endpoints require credentials', async () => {
  const handler = await createJobFlowHandler({ service: fakeService(), requireAuth: true, apiKey: 'test-secret' });
  const base = await listen(handler);

  const health = await fetch(`${base}/health/ready`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ready');
  assert.ok(health.headers.get('x-request-id'));
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');

  const denied = await fetch(`${base}/api/dashboard`);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error, 'unauthorized');

  const allowed = await fetch(`${base}/api/dashboard`, {
    headers: { authorization: 'Bearer test-secret' },
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { revenue: { collected: 100 } });
});

test('production API exposes the customer-to-revenue operating path', async () => {
  const handler = await createJobFlowHandler({ service: fakeService(), requireAuth: true, apiKey: 'test-secret' });
  const base = await listen(handler);
  const headers = { authorization: 'Bearer test-secret', 'content-type': 'application/json' };

  let response = await fetch(`${base}/api/leads`, { method: 'POST', headers, body: JSON.stringify({ name: 'Ada' }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, 'lead-1');

  response = await fetch(`${base}/api/leads/lead-1/qualify`, { method: 'POST', headers, body: JSON.stringify({ service: 'consultation' }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).qualified, true);

  response = await fetch(`${base}/api/leads/lead-1/customer`, { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).sourceLeadId, 'lead-1');

  response = await fetch(`${base}/api/appointments`, { method: 'POST', headers, body: JSON.stringify({ customerId: 'customer-1', startsAt: '2026-09-01T15:00:00Z' }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, 'appointment-1');

  response = await fetch(`${base}/api/appointments/appointment-1/status`, { method: 'POST', headers, body: JSON.stringify({ status: 'completed' }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'completed');

  response = await fetch(`${base}/api/payments`, { method: 'POST', headers, body: JSON.stringify({ customerId: 'customer-1', amount: 125 }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, 'payment-1');
});

test('rate limiter fails closed when a caller exceeds the configured budget', async () => {
  const handler = await createJobFlowHandler({
    service: fakeService(),
    requireAuth: true,
    apiKey: 'test-secret',
    rateLimitMax: 1,
    rateLimitWindowMs: 60_000,
  });
  const base = await listen(handler);
  const headers = { authorization: 'Bearer test-secret' };

  const first = await fetch(`${base}/api/dashboard`, { headers });
  assert.equal(first.status, 200);
  const second = await fetch(`${base}/api/dashboard`, { headers });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error, 'rate_limited');
});
