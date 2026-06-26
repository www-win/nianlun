import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'nianlun.ai.settings'
const DEFAULT_MODEL = 'claude-opus-4-8'

export const useSettingsStore = defineStore('settings', () => {
  // 预置接入信息从构建期环境变量读取（见 .env / vite-env.d.ts）。
  // 界面不再暴露 AI 设置，用户无需也无法手动配置。
  const baseUrl = ref(import.meta.env.VITE_AI_BASE_URL ?? '')
  const apiKey = ref(import.meta.env.VITE_AI_API_KEY ?? '')
  const model = ref(import.meta.env.VITE_AI_MODEL || DEFAULT_MODEL)

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
