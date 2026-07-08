import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Friend, ReportData, Relation, MbtiCode } from '@nianlun/core'
import { storage as defaultStorage, makeStorage } from '../adapters/storage'
import { rawStore as defaultRawStore, makeRawStore } from '../adapters/rawStore'

type Storage = ReturnType<typeof makeStorage>
type RawStore = ReturnType<typeof makeRawStore>

// 工厂：测试注入内存 storage/rawStore；运行时用默认 wx storage/文件系统。
export function createDataStore(storage: Storage = defaultStorage, rawStore: RawStore = defaultRawStore) {
  return defineStore('data', () => {
    const friends = ref<Friend[]>([])
    const report = ref<ReportData | null>(null)
    const hasData = computed(() => friends.value.length > 0)
    let onSaved: (() => void) | null = null
    function setOnSaved(fn: () => void) { onSaved = fn }
    const fireSaved = () => { try { onSaved?.() } catch { /* 备份触发失败不影响本地保存 */ } }

    async function hydrate() {
      friends.value = storage.loadFriends()
      report.value = storage.loadReport()
    }
    async function setData(newFriends: Friend[], newReport: ReportData) {
      friends.value = newFriends
      report.value = newReport
      storage.saveFriends(JSON.parse(JSON.stringify(newFriends)))
      storage.saveReport(JSON.parse(JSON.stringify(newReport)))
      fireSaved()
    }
    async function updateFriend(
      id: string,
      patch: { role?: string; rel?: Relation; alias?: string; mbti?: MbtiCode | null },
    ) {
      const f = friends.value.find((x) => x.id === id)
      if (!f) return
      if (patch.role !== undefined) { f.role = patch.role; f.userEdited.role = patch.role }
      if (patch.rel !== undefined) { f.rel = patch.rel; f.userEdited.rel = patch.rel }
      if (patch.alias !== undefined) { f.alias = patch.alias; f.userEdited.alias = patch.alias }
      if (patch.mbti !== undefined) {
        if (patch.mbti === null) delete f.userEdited.mbti
        else f.userEdited.mbti = patch.mbti
      }
      storage.saveFriends(JSON.parse(JSON.stringify(friends.value)))
      fireSaved()
    }
    async function clear() {
      friends.value = []; report.value = null; storage.clearAll(); rawStore.clear()
    }
    return { friends, report, hasData, hydrate, setData, updateFriend, clear, setOnSaved }
  })
}

export const useDataStore = createDataStore()
