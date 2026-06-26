import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'nianlun.ai.settings'
const DEFAULT_MODEL = 'claude-opus-4-8'

export const useSettingsStore = defineStore('settings', () => {
  const baseUrl = ref('')
  const apiKey = ref('')
  const model = ref(DEFAULT_MODEL)

  const isConfigured = computed(
    () => baseUrl.value.trim() !== '' && apiKey.value.trim() !== '',
  )

  function hydrate() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      baseUrl.value = s.baseUrl ?? ''
      apiKey.value = s.apiKey ?? ''
      model.value = s.model || DEFAULT_MODEL
    } catch {
      /* 损坏的存储忽略即可 */
    }
  }

  function update(patch: { baseUrl?: string; apiKey?: string; model?: string }) {
    if (patch.baseUrl !== undefined) baseUrl.value = patch.baseUrl
    if (patch.apiKey !== undefined) apiKey.value = patch.apiKey
    if (patch.model !== undefined) model.value = patch.model
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ baseUrl: baseUrl.value, apiKey: apiKey.value, model: model.value }),
    )
  }

  return { baseUrl, apiKey, model, isConfigured, hydrate, update }
})
