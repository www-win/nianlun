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

export async function clearAll(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['friends', 'meta'], 'readwrite')
  await tx.objectStore('friends').clear()
  await tx.objectStore('meta').clear()
  await tx.done
}
