<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { generateText } from '../adapters/aiClient'

const props = defineProps<{
  buildPrompt: () => string
  buttonLabel: string
  busyLabel: string
}>()

const settings = useSettingsStore()

const baseUrl = ref(settings.baseUrl)
const apiKey = ref(settings.apiKey)
const model = ref(settings.model)
function saveSettings() {
  settings.update({ baseUrl: baseUrl.value, apiKey: apiKey.value, model: model.value })
}

const isConfigured = computed(() => settings.isConfigured)

const loading = ref(false)
const error = ref('')
const result = ref('')

async function generate() {
  error.value = ''
  result.value = ''
  loading.value = true
  try {
    const prompt = props.buildPrompt()
    result.value = await generateText(prompt, {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '生成失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="ai-panel">
    <details class="ai-settings">
      <summary>AI 设置</summary>
      <label>接入地址
        <input v-model="baseUrl" placeholder="https://api.gaccode.com" />
      </label>
      <label>API Key
        <input v-model="apiKey" type="password" placeholder="sk-..." />
      </label>
      <label>模型
        <input v-model="model" />
      </label>
      <button type="button" @click="saveSettings">保存</button>
    </details>

    <button
      class="btn btn-primary btn-sm"
      type="button"
      data-test="gen"
      :disabled="!isConfigured || loading"
      @click="generate"
    >
      {{ loading ? busyLabel : buttonLabel }}
    </button>
    <p class="ai-privacy">使用 AI 功能时，相关统计数据会发送至 AI 服务进行处理。</p>

    <p v-if="error" class="ai-error" role="alert">{{ error }}</p>
    <p v-if="result" class="ai-result" data-test="result">{{ result }}</p>
  </section>
</template>
