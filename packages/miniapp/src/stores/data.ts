import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Friend, ReportData, Relation } from '@nianlun/core'
import { storage as defaultStorage, makeStorage } from '../adapters/storage'

type Storage = ReturnType<typeof makeStorage>

// 工厂：测试注入内存 storage；运行时用默认 wx storage。
export function createDataStore(storage: Storage = defaultStorage) {
  return defineStore('data', () => {
    const friends = ref<Friend[]>([])
    const report = ref<ReportData | null>(null)
    const hasData = computed(() => friends.value.length > 0)

    async function hydrate() {
      friends.value = storage.loadFriends()
      report.value = storage.loadReport()
    }
    async function setData(newFriends: Friend[], newReport: ReportData) {
      friends.value = newFriends
      report.value = newReport
      storage.saveFriends(JSON.parse(JSON.stringify(newFriends)))
      storage.saveReport(JSON.parse(JSON.stringify(newReport)))
    }
    async function updateFriend(id: string, patch: { role?: string; rel?: Relation; alias?: string }) {
      const f = friends.value.find((x) => x.id === id)
      if (!f) return
      if (patch.role !== undefined) { f.role = patch.role; f.userEdited.role = patch.role }
      if (patch.rel !== undefined) { f.rel = patch.rel; f.userEdited.rel = patch.rel }
      if (patch.alias !== undefined) { f.alias = patch.alias; f.userEdited.alias = patch.alias }
      storage.saveFriends(JSON.parse(JSON.stringify(friends.value)))
    }
    async function clear() {
      friends.value = []; report.value = null; storage.clearAll()
    }
    return { friends, report, hasData, hydrate, setData, updateFriend, clear }
  })
}

export const useDataStore = createDataStore()
