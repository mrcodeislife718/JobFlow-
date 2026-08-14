import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createJobFlowHandler } from './web-handler.js';

export async function startJobFlowServer({ port = Number(process.env.PORT ?? 3000), host = process.env.HOST ?? '0.0.0.0' } = {}) {
  const handler = await createJobFlowHandler();
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startJobFlowServer();
  const address = server.address();
  console.log(`JobFlow listening on ${typeof address === 'object' && address ? address.port : port}`);
}
