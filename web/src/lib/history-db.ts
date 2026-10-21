import type { FluidResultsResponse, VehicleForm } from '@/types/fluid'
import type { FluidCardModel } from '@/lib/results-mapper'

/**
 * F4 (Tier 1 Industry): browser-native IndexedDB vehicle history.
 * No Dexie, no cloud - sessions persist locally on the workshop tablet so
 * a technician can answer "what did this plate read at 25,000 km?".
 * The IDB plumbing is normalized behind a tiny store interface so tests
 * can inject an in-memory equivalent (jsdom ships no indexedDB).
 */

export interface DiagnosticRun {
  id?: number
  /** Verbatim plate, NOT lowercased (plates are case-significant in some states). */
  vehicleNumber: string
  date: string
  kmUsage: number
  createdAt: number
  /** Linkage to F1 profile selection used at capture time. */
  brakeProfileId: string | null
  engineProfileId: string | null
  /** Verbatim wire snapshot (raw statuses preserved). */
  firmwareRaw: FluidResultsResponse
  /** Post-mapper view model for instant replay. */
  cards: FluidCardModel[]
}

export const DB_NAME = 'flowmetrics_db'
export const DB_VERSION = 1
export const RUNS_STORE = 'runs'

/** Minimal surface this module exercises; the in-memory mock in tests
 * implements exactly this, keeping the test fake ~40 lines. `put`
 * resolves to the generated primary key (uniform across IDB and the mock). */
export interface RunsStore {
  put(value: DiagnosticRun): Promise<number>
  getAll(): Promise<DiagnosticRun[]>
  delete(key: number): Promise<void>
}

export type RunsStoreFactory = () => Promise<RunsStore>

let storeFactory: RunsStoreFactory = createIdbRunsStore

/** Test seam: swap the underlying store implementation. */
export function setRunsStoreFactoryForTests(factory: RunsStoreFactory): void {
  storeFactory = factory
}

export function resetRunsStoreFactory(): void {
  storeFactory = createIdbRunsStore
}

function withRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function withTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function openDb(): Promise<IDBDatabase> {
  const idb = globalThis.indexedDB
  if (!idb) {
    return Promise.reject(new Error('IndexedDB unavailable in this environment'))
  }
  return new Promise((resolve, reject) => {
    const open = idb.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        // Indexes are created for completeness / cross-tool inspection;
        // reads filter in-memory on getAll to keep this wrapper (and the
        // test fake) dependency-light for small record counts.
        const store = db.createObjectStore(RUNS_STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('vehicleNumber', 'vehicleNumber')
        store.createIndex('createdAt', 'createdAt')
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('IndexedDB open failed'))
  })
}

/** Default store backed by the browser's real IndexedDB. */
export async function createIdbRunsStore(): Promise<RunsStore> {
  const db = await openDb()
  return {
    async put(value: DiagnosticRun): Promise<number> {
      const tx = db.transaction(RUNS_STORE, 'readwrite')
      const key = await withRequest(tx.objectStore(RUNS_STORE).put(value))
      await withTransaction(tx)
      return Number(key)
    },
    async getAll(): Promise<DiagnosticRun[]> {
      const tx = db.transaction(RUNS_STORE, 'readonly')
      const rows = await withRequest(tx.objectStore(RUNS_STORE).getAll())
      return rows as DiagnosticRun[]
    },
    async delete(key: number): Promise<void> {
      const tx = db.transaction(RUNS_STORE, 'readwrite')
      tx.objectStore(RUNS_STORE).delete(key)
      await withTransaction(tx)
    },
  }
}

export async function saveRun(
  run: Omit<DiagnosticRun, 'id'>,
): Promise<number> {
  const store = await storeFactory()
  return store.put(run as DiagnosticRun)
}

/** All runs for a vehicle, newest first. */
export async function listRunsByVehicle(vehicleNumber: string): Promise<DiagnosticRun[]> {
  const store = await storeFactory()
  const all = await store.getAll()
  return all
    .filter((r) => r.vehicleNumber === vehicleNumber.trim())
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function recentRuns(limit: number): Promise<DiagnosticRun[]> {
  const store = await storeFactory()
  const all = await store.getAll()
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

export async function deleteRun(id: number): Promise<void> {
  const store = await storeFactory()
  await store.delete(id)
}

/** Builds the persisted run from a completed session (App-side assembly). */
export function buildDiagnosticRun(
  form: VehicleForm,
  data: FluidResultsResponse,
  cards: FluidCardModel[],
  profileIds: { brakeProfileId: string | null; engineProfileId: string | null },
): Omit<DiagnosticRun, 'id'> {
  return {
    vehicleNumber: form.vehicleNumber,
    date: form.date,
    kmUsage: form.kmUsage,
    createdAt: Date.now(),
    brakeProfileId: profileIds.brakeProfileId,
    engineProfileId: profileIds.engineProfileId,
    firmwareRaw: data,
    cards,
  }
}
