import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { JsonStore } from '../src/store.js';

test('JsonStore serializes overlapping saves and leaves valid JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jobflow-store-'));
  const path = join(directory, 'state.json');

  try {
    const store = new JsonStore(path);

    await Promise.all([
      store.save({ revision: 1, value: 'first' }),
      store.save({ revision: 2, value: 'second' }),
      store.save({ revision: 3, value: 'third' })
    ]);

    const raw = await readFile(path, 'utf8');
    const persisted = JSON.parse(raw);

    assert.deepEqual(persisted, { revision: 3, value: 'third' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('JsonStore continues accepting saves after a completed write chain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jobflow-store-'));
  const path = join(directory, 'state.json');

  try {
    const store = new JsonStore(path);
    await store.save({ revision: 1 });
    await store.save({ revision: 2 });

    assert.deepEqual(await store.load(), { revision: 2 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
