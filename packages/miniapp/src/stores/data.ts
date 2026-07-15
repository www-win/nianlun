import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Friend, ReportData, Relation, MbtiCode } from '@nianlun/core'
import { friendReportFields } from '@nianlun/core'
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
      const fs = storage.loadFriends()
      const r = storage.loadReport()
      friends.value = fs
      // 报告的好友派生字段以「已存全量好友」为准重算，自愈旧版本遗留的过期 top 榜/关系分布
      // （旧逻辑曾只按最后一批导入生成，会与好友列表对不上）。
      report.value = r ? { ...r, ...friendReportFields(fs) } : r
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
      // [perf] 诊断插桩：拆分「整表深拷贝 / 写盘 / 触发备份」三步耗时，定位卡顿源。排查完删。
      const _t0 = Date.now()
      const snap = JSON.parse(JSON.stringify(friends.value))
      const _t1 = Date.now()
      storage.saveFriends(snap)
      const _t2 = Date.now()
      fireSaved()
      const _t3 = Date.now()
      // eslint-disable-next-line no-console
      console.log(`[perf] updateFriend n=${friends.value.length} clone=${_t1 - _t0}ms save=${_t2 - _t1}ms fireSaved=${_t3 - _t2}ms`)
    }
    async function clear() {
      friends.value = []; report.value = null; storage.clearAll(); rawStore.clear()
    }
    return { friends, report, hasData, hydrate, setData, updateFriend, clear, setOnSaved }
  })
}

export const useDataStore = createDataStore()
