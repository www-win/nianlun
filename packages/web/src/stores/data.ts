import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'
import type { Friend, ReportData, Relation } from '@nianlun/core'
import { saveFriends, loadFriends, saveReport, loadReport, clearAll } from '../adapters/storage'

export const useDataStore = defineStore('data', () => {
  const friends = ref<Friend[]>([])
  const report = ref<ReportData | null>(null)
  const hasData = computed(() => friends.value.length > 0)

  async function hydrate() {
    friends.value = await loadFriends()
    report.value = await loadReport()
  }

  async function setData(newFriends: Friend[], newReport: ReportData) {
    friends.value = newFriends
    report.value = newReport
    await saveFriends(newFriends.map((f) => toRaw(f)))
    await saveReport(toRaw(newReport))
  }

  async function updateFriend(id: string, patch: { role?: string; rel?: Relation; alias?: string }) {
    const f = friends.value.find((x) => x.id === id)
    if (!f) return
    if (patch.role !== undefined) { f.role = patch.role; f.userEdited.role = patch.role }
    if (patch.rel !== undefined) { f.rel = patch.rel; f.userEdited.rel = patch.rel }
    if (patch.alias !== undefined) { f.alias = patch.alias; f.userEdited.alias = patch.alias }
    await saveFriends(friends.value.map((f) => toRaw(f)))
  }

  async function clear() {
    friends.value = []
    report.value = null
    await clearAll()
  }

  return { friends, report, hasData, hydrate, setData, updateFriend, clear }
})
