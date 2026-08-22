const DATABASE = 'rednote-web-handles';
const STORE = 'workspace';
const KEY = 'active';

export interface StoredWorkspaceHandle {
  readonly directoryName: string;
  readonly handle: FileSystemDirectoryHandle;
  readonly workspaceId: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(new Error('HANDLE_STORE_UNAVAILABLE'));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadWorkspaceHandle(): Promise<StoredWorkspaceHandle | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(KEY);
    request.onerror = () => reject(new Error('HANDLE_STORE_UNAVAILABLE'));
    request.onsuccess = () =>
      resolve((request.result as StoredWorkspaceHandle | undefined) ?? null);
    transaction.oncomplete = () => database.close();
  });
}

export async function saveWorkspaceHandle(value: StoredWorkspaceHandle): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(value, KEY);
    transaction.onerror = () => reject(new Error('HANDLE_STORE_UNAVAILABLE'));
    transaction.oncomplete = () => resolve();
  });
  database.close();
}
