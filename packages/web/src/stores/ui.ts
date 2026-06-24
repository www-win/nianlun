import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ReportTheme = 'jade' | 'dusk' | 'ink'

export const useUiStore = defineStore('ui', () => {
  const reportTheme = ref<ReportTheme>('jade')
  function setTheme(t: ReportTheme) { reportTheme.value = t }
  return { reportTheme, setTheme }
})
