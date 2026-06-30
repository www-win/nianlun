import {
  buildReportCopyPrompt, buildFriendSuggestionPrompt, parseFriendSuggestion,
} from '@nianlun/core'
import type { Friend, ReportData, FriendSuggestion } from '@nianlun/core'

export type Transport = (prompt: string, maxTokens: number) => Promise<string>

export function makeAiClient(transport: Transport) {
  return {
    async generateReportCopy(report: ReportData, friends: Friend[]): Promise<string> {
      return transport(buildReportCopyPrompt(report, friends), 1024)
    },
    async suggestFriend(friend: Friend, samples: string[]): Promise<FriendSuggestion> {
      const text = await transport(buildFriendSuggestionPrompt(friend, samples), 1024)
      return parseFriendSuggestion(text)
    },
  }
}

// —— 后端 A：云函数 —— //
const cloudTransport: Transport = async (prompt, maxTokens) => {
  // 惰性访问 wx，避免模块顶层触发
  const res = await wx.cloud.callFunction({ name: 'aiProxy', data: { prompt, maxTokens } })
  const r = res.result as { text?: string; error?: string }
  if (r.error) throw new Error(r.error)
  return r.text ?? ''
}

// —— 后端 B：公司服务器 HTTPS 反代 —— //
const PROXY_URL = (globalThis as any).__AI_PROXY_URL__ ?? ''
const proxyTransport: Transport = (prompt, maxTokens) => new Promise((resolve, reject) => {
  // 惰性访问 wx，避免模块顶层触发
  wx.request({
    url: PROXY_URL, method: 'POST',
    header: { 'content-type': 'application/json' },
    data: { prompt, maxTokens },
    success: (res) => {
      if (res.statusCode !== 200) return reject(new Error(`AI 服务错误 HTTP ${res.statusCode}`))
      const d = res.data as { text?: string; error?: string }
      if (d.error) return reject(new Error(d.error))
      resolve(d.text ?? '')
    },
    fail: (err) => reject(new Error(`无法连接 AI 服务：${err.errMsg}`)),
  })
})

// 构建期注入（uni-app 用 import.meta.env / define）。默认 cloud。
const BACKEND = (import.meta as any).env?.VITE_AI_BACKEND ?? 'cloud'
export const aiClient = makeAiClient(BACKEND === 'proxy' ? proxyTransport : cloudTransport)
