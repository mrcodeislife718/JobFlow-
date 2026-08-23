import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonStore {
  constructor(path) {
    this.path = path;
    this.saveQueue = Promise.resolve();
  }

  async load(fallback = {}) {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return structuredClone(fallback);
      throw error;
    }
  }

  async save(value) {
    const snapshot = structuredClone(value);
    const operation = this.saveQueue.then(() => this.#writeSnapshot(snapshot));
    this.saveQueue = operation.catch(() => undefined);
    return operation;
  }

  async #writeSnapshot(value) {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temp, this.path);
  }
}
