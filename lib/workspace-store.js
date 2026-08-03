import { KNOWLEDGE_SCHEMA_VERSION } from "./knowledge-contracts.js";
import { isExpired } from "./workspace-utils.js";

const DATABASE_NAME = "quizbuddy-knowledge";
const DATABASE_VERSION = 1;
const STORES = [
  "workspaces",
  "contexts",
  "artifacts",
  "memories",
  "customSkills",
  "metrics"
];

export class WorkspaceStore {
  constructor(options = {}) {
    this.indexedDB = options.indexedDB || globalThis.indexedDB;
    this.databaseName = options.databaseName || DATABASE_NAME;
    this.sessionOnly = options.sessionOnly === true;
    this.sessionData = new Map(STORES.map((name) => [name, new Map()]));
    this.databasePromise = null;
  }

  async put(storeName, record) {
    validateStoreName(storeName);
    if (!record?.id) throw new Error("Stored records require an id.");
    if (this.sessionOnly) {
      this.sessionData.get(storeName).set(record.id, structuredClone(record));
      return record;
    }
    const database = await this.open();
    await requestToPromise(
      database.transaction(storeName, "readwrite").objectStore(storeName).put(record)
    );
    return record;
  }

  async get(storeName, id) {
    validateStoreName(storeName);
    if (this.sessionOnly) {
      return structuredClone(this.sessionData.get(storeName).get(id) || null);
    }
    const database = await this.open();
    return (
      (await requestToPromise(
        database.transaction(storeName).objectStore(storeName).get(id)
      )) || null
    );
  }

  async getAll(storeName) {
    validateStoreName(storeName);
    if (this.sessionOnly) {
      return [...this.sessionData.get(storeName).values()].map((record) =>
        structuredClone(record)
      );
    }
    const database = await this.open();
    return requestToPromise(
      database.transaction(storeName).objectStore(storeName).getAll()
    );
  }

  async delete(storeName, id) {
    validateStoreName(storeName);
    if (this.sessionOnly) {
      this.sessionData.get(storeName).delete(id);
      return;
    }
    const database = await this.open();
    await requestToPromise(
      database.transaction(storeName, "readwrite").objectStore(storeName).delete(id)
    );
  }

  async clearAll() {
    if (this.sessionOnly) {
      for (const store of this.sessionData.values()) store.clear();
      return;
    }
    const database = await this.open();
    const transaction = database.transaction(STORES, "readwrite");
    await Promise.all(
      STORES.map((storeName) =>
        requestToPromise(transaction.objectStore(storeName).clear())
      )
    );
  }

  async applyRetention(policy, now = Date.now()) {
    if (policy === "session") {
      if (!this.sessionOnly) await this.clearAll();
      return;
    }
    if (policy === "forever") return;
    for (const storeName of ["workspaces", "contexts", "artifacts"]) {
      const records = await this.getAll(storeName);
      await Promise.all(
        records
          .filter((record) => isExpired(record, policy, now))
          .map((record) => this.delete(storeName, record.id))
      );
    }
  }

  async open() {
    if (this.sessionOnly) {
      throw new Error("Session-only storage does not open IndexedDB.");
    }
    if (!this.indexedDB) {
      throw new Error("IndexedDB is unavailable.");
    }
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open(this.databaseName, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          for (const storeName of STORES) {
            if (!database.objectStoreNames.contains(storeName)) {
              database.createObjectStore(storeName, { keyPath: "id" });
            }
          }
          const transaction = request.transaction;
          transaction.objectStore("workspaces").put({
            id: "__schema__",
            schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
            title: "Schema metadata",
            contextIds: [],
            artifactIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.databasePromise;
  }
}

function validateStoreName(storeName) {
  if (!STORES.includes(storeName)) {
    throw new Error(`Unknown workspace store: ${storeName}`);
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
