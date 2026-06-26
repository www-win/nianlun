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
