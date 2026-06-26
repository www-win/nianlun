import './styles/app.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useDataStore } from './stores/data'
import { useSettingsStore } from './stores/settings'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 启动即尝试从 IndexedDB 恢复已有数据(失败不阻断挂载)
useDataStore().hydrate().catch((e) => { if (import.meta.env.DEV) console.warn('[nianlun] hydrate failed:', e) })
useSettingsStore().hydrate()

app.mount('#app')
