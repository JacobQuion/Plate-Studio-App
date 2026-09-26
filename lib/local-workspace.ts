import type { Workspace } from "@/lib/workspace";

/** IndexedDB keeps full uploaded images without localStorage's small size limit. */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("plate-studio", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("workspace"); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Close other Plate Studio tabs to enable local history."));
    req.onsuccess = () => resolve(req.result);
  });
}

export async function loadWorkspace(): Promise<Workspace | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction("workspace", "readonly").objectStore("workspace").get("current");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const value = req.result as Workspace | undefined;
        if (value && (value.version !== 1 || !Array.isArray(value.library) || !Array.isArray(value.dishHistory) || !Array.isArray(value.locations) || !Array.isArray(value.locationHistory) || !Array.isArray(value.project?.scenes))) return reject(new Error("The saved workspace couldn't be read."));
        resolve(value ?? null);
      };
    });
  } finally { db.close(); }
}

// Serialize snapshots so a slower write cannot overwrite a newer removal/restore.
let writes: Promise<void> = Promise.resolve();
export function saveWorkspace(workspace: Workspace): Promise<void> {
  const snapshot = structuredClone(workspace);
  const write = writes.catch(() => {}).then(async () => {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("workspace", "readwrite");
        tx.objectStore("workspace").put(snapshot, "current");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Local save was interrupted."));
      });
    } finally { db.close(); }
  });
  writes = write;
  return write;
}
