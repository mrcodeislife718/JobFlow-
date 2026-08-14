import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonStore {
  constructor(path) { this.path = path; }
  async load(fallback = {}) {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return structuredClone(fallback); throw error; }
  }
  async save(value) {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temp, this.path);
  }
}
