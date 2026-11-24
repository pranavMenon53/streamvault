import type { OfflineVideoRecord } from '../types/video';

const DB_NAME = 'streamvault_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_videos';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open offline storage'));
  });
}

export async function saveOfflineVideo(record: OfflineVideoRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to save offline copy'));
    };
  });
}

export async function getAllOfflineVideos(): Promise<OfflineVideoRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const items = (request.result as OfflineVideoRecord[]).sort(
        (a, b) => b.savedAt - a.savedAt
      );
      db.close();
      resolve(items);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error('Failed to read offline library'));
    };
  });
}

export async function getOfflineVideoById(id: string): Promise<OfflineVideoRecord | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      db.close();
      resolve(request.result as OfflineVideoRecord | undefined);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error('Failed to read offline video'));
    };
  });
}

export async function deleteOfflineVideo(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to delete offline copy'));
    };
  });
}

export async function getStorageUsageSummary(): Promise<{ usedBytes: number; quotaBytes: number }> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      return {
        usedBytes: estimate.usage ?? 0,
        quotaBytes: estimate.quota ?? 0,
      };
    } catch {
      // ignore if unsupported
    }
  }
  return { usedBytes: 0, quotaBytes: 0 };
}

export function triggerDeviceBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 1500);
}
