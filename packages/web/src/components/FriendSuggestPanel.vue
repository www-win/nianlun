<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Friend, Relation } from '@nianlun/core'
import { buildFriendSuggestionPrompt, parseFriendSuggestion } from '@nianlun/core'
import { useSettingsStore } from '../stores/settings'
import { generateText } from '../adapters/aiClient'

const props = defineProps<{
  friend: Friend
  samples: string[]
}>()

const emit = defineEmits<{
  apply: [payload: { rel?: Relation; role?: string }]
}>()

const settings = useSettingsStore()

const hasSamples = computed(() => props.samples.length > 0)
const canRun = computed(() => settings.isConfigured && hasSamples.value)

const loading = ref(false)
const error = ref('')
const suggestion = ref<{ rel?: Relation; role?: string; reason?: string } | null>(null)

async function suggest() {
  error.value = ''
  suggestion.value = null
  loading.value = true
  try {
    const prompt = buildFriendSuggestionPrompt(props.friend, props.samples)
    const text = await generateText(prompt, {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    })
    const parsed = parseFriendSuggestion(text)
    if (parsed.rel === undefined && parsed.role === undefined && parsed.reason === undefined) {
      error.value = 'AI 返回格式无法识别，请重试'
      return
    }
    suggestion.value = parsed
  } catch (e) {
    error.value = e instanceof Error ? e.message : '建议失败'
  } finally {
    loading.value = false
  }
}

function apply() {
  if (!suggestion.value) return
  const payload: { rel?: Relation; role?: string } = {}
  if (suggestion.value.rel !== undefined) payload.rel = suggestion.value.rel
  if (suggestion.value.role !== undefined) payload.role = suggestion.value.role
  emit('apply', payload)
}
</script>

<template>
  <section class="suggest-panel">
    <button
      class="btn btn-primary btn-sm"
      type="button"
      data-test="suggest"
      :disabled="!canRun || loading"
      @click="suggest"
    >
      {{ loading ? '分析中…' : '✨ AI 建议关系/职务' }}
    </button>

    <p class="suggest-privacy">
      AI 建议关系/职务需要把该好友的部分聊天内容发送至 AI 服务进行处理。聊天内容不会被保存，仅用于本次分析。
    </p>
    <p v-if="!hasSamples" class="suggest-hint">
      请重新导入聊天记录后再分析（样本仅存于本次会话，刷新后失效）。
    </p>

    <p v-if="error" class="suggest-error" role="alert">{{ error }}</p>

    <div v-if="suggestion" class="suggest-result" data-test="suggest-result">
      <div class="row"><span class="lab">建议关系</span><span class="val">{{ suggestion.rel ?? '—' }}</span></div>
      <div class="row"><span class="lab">建议职务</span><span class="val">{{ suggestion.role || '—' }}</span></div>
      <div class="row" v-if="suggestion.reason"><span class="lab">依据</span><span class="val">{{ suggestion.reason }}</span></div>
      <button class="btn btn-sm" type="button" data-test="apply" @click="apply">采纳并写入</button>
    </div>
  </section>
</template>

<style scoped>
.suggest-panel { display: flex; flex-direction: column; gap: 8px; }
.suggest-privacy { font-size: 12px; color: var(--faint); line-height: 1.5; }
.suggest-hint { font-size: 12px; color: var(--accent-strong); }
.suggest-error { font-size: 13px; color: oklch(55% 0.18 25); }
.suggest-result { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; display: grid; gap: 8px; }
.suggest-result .row { display: flex; gap: 10px; font-size: 13px; }
.suggest-result .lab { color: var(--faint); flex: none; width: 56px; }
.suggest-result .val { color: var(--fg); font-weight: 550; }
.suggest-result .btn { margin-top: 4px; justify-self: start; }
</style>
