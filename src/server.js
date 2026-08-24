import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createJobFlowHandler } from './web-handler.js';

export async function startJobFlowServer({
  port = Number(process.env.PORT ?? 3000),
  host = process.env.HOST ?? '0.0.0.0',
  handlerOptions = {},
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid JobFlow port: ${port}`);
  const handler = await createJobFlowHandler(handlerOptions);
  const server = createServer(handler);
  server.requestTimeout = Number(process.env.JOBFLOW_REQUEST_TIMEOUT_MS ?? 30_000);
  server.headersTimeout = Number(process.env.JOBFLOW_HEADERS_TIMEOUT_MS ?? 15_000);
  server.keepAliveTimeout = Number(process.env.JOBFLOW_KEEPALIVE_TIMEOUT_MS ?? 5_000);
  server.maxRequestsPerSocket = Number(process.env.JOBFLOW_MAX_REQUESTS_PER_SOCKET ?? 1_000);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

function closeServer(server, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, timeoutMs);
    timer.unref?.();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startJobFlowServer();
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : process.env.PORT ?? 3000;
  console.log(`JobFlow listening on ${boundPort}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`JobFlow received ${signal}; draining connections.`);
    await closeServer(server);
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}
