import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatQaTurn, ChatQaContext } from '@nianlun/core'
import { useDataStore as defaultUseData, createDataStore } from './data'
import { aiClient } from '../adapters/aiClient'
import { makeChatQaRetrieval, type ChatQaRetrieval } from '../adapters/chatQaRetrieval'

type AnswerFn = (question: string, history: ChatQaTurn[], context: ChatQaContext) => Promise<string>
type Deps = {
  useData?: ReturnType<typeof createDataStore>
  retrieval?: ChatQaRetrieval
  answer?: AnswerFn
}

const HISTORY_TURNS = 6      // 每轮最多带 6 条历史进 prompt，控制 token
const DEGRADE_HINT = '（提示：本机没有原始聊天记录，具体聊天内容需在原设备、或重新导入原文后才能查。）'

// 工厂：测试注入内存 data store/retrieval/answer；运行时用真实依赖。
// 对话仅存内存，不持久化（隐私要求）。
export function createChatQaStore(deps: Deps = {}) {
  const useData = deps.useData ?? defaultUseData
  const retrieval = deps.retrieval ?? makeChatQaRetrieval()
  const answer: AnswerFn = deps.answer ?? aiClient.answerChatQa

  return defineStore('chatQa', () => {
    const messages = ref<ChatQaTurn[]>([])
    const loading = ref(false)
    const error = ref('')

    async function ask(question: string): Promise<void> {
      const q = question.trim()
      if (!q || loading.value) return
      error.value = ''
      messages.value = [...messages.value, { role: 'user', text: q }]
      loading.value = true
      try {
        const d = useData()
        const { context, rawAvailable, wantedRaw } = retrieval.retrieve(q, d.friends, d.report)
        // 历史取本轮问题之前的最近 HISTORY_TURNS 条
        const history = messages.value.slice(0, -1).slice(-HISTORY_TURNS)
        let text = await answer(q, history, context)
        if (wantedRaw && !rawAvailable) text += `\n\n${DEGRADE_HINT}`
        messages.value = [...messages.value, { role: 'assistant', text }]
      } catch (e) {
        error.value = (e as Error)?.message ?? String(e)
        messages.value = [...messages.value, { role: 'assistant', text: `出错了：${error.value}` }]
      } finally {
        loading.value = false
      }
    }

    function clear() { messages.value = []; error.value = '' }

    return { messages, loading, error, ask, clear }
  })
}

export const useChatQaStore = createChatQaStore()
