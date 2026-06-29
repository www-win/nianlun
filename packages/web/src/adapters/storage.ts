import { openDB, type IDBPDatabase } from 'idb'
import type { Friend, ReportData } from '@nianlun/core'

const DB_NAME = 'nianlun'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('friends')) db.createObjectStore('friends', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      },
    })
  }
  return dbPromise
}

export async function saveFriends(friends: Friend[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('friends', 'readwrite')
  await tx.store.clear()
  for (const f of friends) await tx.store.put(f)
  await tx.done
}

export async function loadFriends(): Promise<Friend[]> {
  const db = await getDB()
  return (await db.getAll('friends')) as Friend[]
}

export async function saveReport(report: ReportData): Promise<void> {
  const db = await getDB()
  await db.put('meta', report, 'report')
}

export async function loadReport(): Promise<ReportData | null> {
  const db = await getDB()
  return ((await db.get('meta', 'report')) as ReportData | undefined) ?? null
}

// 有界的聊天样本(每好友少量片段)，供 AI 建议在刷新后仍可用。存于 meta 库的 'samples' 键。
export async function saveSamples(samples: Record<string, string[]>): Promise<void> {
  const db = await getDB()
  await db.put('meta', samples, 'samples')
}

export async function loadSamples(): Promise<Record<string, string[]>> {
  const db = await getDB()
  return ((await db.get('meta', 'samples')) as Record<string, string[]> | undefined) ?? {}
}

export async function clearAll(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['friends', 'meta'], 'readwrite')
  await tx.objectStore('friends').clear()
  await tx.objectStore('meta').clear()
  await tx.done
}

export function resetDB(): void {
  dbPromise = null
}
