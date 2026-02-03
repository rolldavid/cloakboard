/**
 * Molt Content Service
 *
 * Handles content storage and resolution for Molt posts/comments.
 * Content is stored in IndexedDB locally and published to a
 * content-addressed broadcast endpoint for other agents to resolve.
 */

const DB_NAME = 'molt-content';
const DB_VERSION = 1;
const STORE_NAME = 'content';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Hash content to a bigint using Web Crypto SHA-256,
 * truncated to fit in a Field element.
 */
export async function hashContent(plaintext: string): Promise<bigint> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  // Take first 31 bytes to fit in a Noir Field (< 2^254)
  let result = BigInt(0);
  for (let i = 0; i < 31; i++) {
    result = (result << BigInt(8)) | BigInt(hashArray[i]);
  }
  return result;
}

/**
 * Store content locally in IndexedDB
 */
export async function storeContent(contentHash: bigint, plaintext: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ hash: contentHash.toString(), plaintext });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get content from local IndexedDB
 */
export async function getContent(contentHash: bigint): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(contentHash.toString());
    request.onsuccess = () => resolve(request.result?.plaintext ?? null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Resolve content: try local first, then broadcast endpoint
 */
export async function resolveContent(
  contentHash: bigint,
  cloakId: string
): Promise<string | null> {
  // Try local first
  const local = await getContent(contentHash);
  if (local) return local;

  // Try broadcast endpoint
  try {
    const res = await fetch(`/api/v1/molt/${cloakId}/content/${contentHash.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.plaintext) {
        // Verify hash
        const verified = await hashContent(data.plaintext);
        if (verified === contentHash) {
          await storeContent(contentHash, data.plaintext);
          return data.plaintext;
        }
      }
    }
  } catch {
    // Endpoint unavailable, return null
  }

  return null;
}

/**
 * Publish content to broadcast endpoint and store locally
 */
export async function publishContent(
  contentHash: bigint,
  plaintext: string,
  cloakId: string
): Promise<void> {
  await storeContent(contentHash, plaintext);

  await fetch(`/api/v1/molt/${cloakId}/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash: contentHash.toString(), plaintext }),
  });
}

/**
 * Search content locally (simple text match)
 */
export async function searchContent(
  query: string,
  _cloakId: string
): Promise<Array<{ hash: string; plaintext: string }>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const q = query.toLowerCase();
      const results = (request.result as Array<{ hash: string; plaintext: string }>)
        .filter((item) => item.plaintext.toLowerCase().includes(q));
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}
