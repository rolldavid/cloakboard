import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { KeeperEntry } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '../../../../keeper-store.json');

function readStore(): KeeperEntry[] {
  if (!existsSync(STORE_PATH)) return [];
  const raw = readFileSync(STORE_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeStore(entries: KeeperEntry[]): void {
  writeFileSync(STORE_PATH, JSON.stringify(entries, null, 2));
}

export function getKeeperStore() {
  return {
    async list(): Promise<KeeperEntry[]> {
      return readStore();
    },

    async get(cloakAddress: string): Promise<KeeperEntry | undefined> {
      return readStore().find((e) => e.cloakAddress === cloakAddress);
    },

    async add(entry: KeeperEntry): Promise<void> {
      const entries = readStore();
      const existing = entries.findIndex((e) => e.cloakAddress === entry.cloakAddress);
      if (existing >= 0) {
        entries[existing] = entry;
      } else {
        entries.push(entry);
      }
      writeStore(entries);
    },

    async addSender(cloakAddress: string, senderAddress: string): Promise<void> {
      const entries = readStore();
      const entry = entries.find((e) => e.cloakAddress === cloakAddress);
      if (!entry) return;
      if (!entry.senderAddresses.includes(senderAddress)) {
        entry.senderAddresses.push(senderAddress);
        writeStore(entries);
      }
    },

    async getSenders(cloakAddress: string): Promise<string[]> {
      const entry = readStore().find((e) => e.cloakAddress === cloakAddress);
      return entry?.senderAddresses || [];
    },
  };
}
