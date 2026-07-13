import {
  buildReportCopyPrompt, buildFriendSuggestionPrompt, parseFriendSuggestion,
  buildFriendSentimentPrompt, buildYearSentimentPrompt, parseSentiment,
  buildFriendProfilePrompt, parseFriendProfile,
  buildMbtiPrompt, parseMbti,
  buildAstroPrompt, parseAstroReading, buildBirthExtractPrompt, parseBirthInfo,
  buildStockExtractionPrompt, parseStockExtraction,
  buildChatQaPrompt, parseChatQaAnswer,
  buildRelationDeepPrompt, parseRelationDeep,
} from '@nianlun/core'
import type {
  Friend, ReportData, FriendSuggestion, Sentiment, FriendProfile, MbtiResult,
  BaziChart, DayFortune, Compatibility, AstroReading, BirthInfo,
  StockPick, ExtractCtx,
  ChatQaTurn, ChatQaContext, RelationDeep,
} from '@nianlun/core'

// model 可选：不传则由后端用默认模型；深度关系分析等重调用可指定更快模型避免云函数超时。
export type Transport = (prompt: string, maxTokens: number, model?: string) => Promise<string>

export function makeAiClient(transport: Transport) {
  return {
    async generateReportCopy(report: ReportData, friends: Friend[]): Promise<string> {
      return transport(buildReportCopyPrompt(report, friends), 1024)
    },
    async suggestFriend(friend: Friend, samples: string[]): Promise<FriendSuggestion> {
      const text = await transport(buildFriendSuggestionPrompt(friend, samples), 1024)
      return parseFriendSuggestion(text)
    },
    async analyzeFriendSentiment(friend: Friend, samples: string[]): Promise<Sentiment> {
      const text = await transport(buildFriendSentimentPrompt(friend, samples), 512)
      return parseSentiment(text)
    },
    async analyzeFriendProfile(friend: Friend, samples: string[]): Promise<FriendProfile> {
      const text = await transport(buildFriendProfilePrompt(friend, samples), 1024)
      return parseFriendProfile(text)
    },
    async analyzeFriendMbti(friend: Friend, samples: string[]): Promise<MbtiResult | null> {
      const text = await transport(buildMbtiPrompt(friend, samples), 768)
      return parseMbti(text)
    },
    async analyzeRelationDeep(friend: Friend, samples: string[]): Promise<RelationDeep> {
      // 话痨好友样本可达 ~60 条(prompt ~6000 字)，输入大 + 生成更长会撞云函数 60s 硬顶(-504003)。
      // ① 样本限量到 20 条把 prompt 压回可控规模；② 拆前/后 5 块两次并行、各半量输出；
      // ③ 不指定 model → 走云函数默认模型（与其它分析一致、确定被代理支持）。三管齐下保 <60s。
      const capped = samples.slice(0, 20)
      const part = (p: 1 | 2) =>
        transport(buildRelationDeepPrompt(friend, capped, p), 2048).then(parseRelationDeep)
      const [a, b] = await Promise.all([part(1), part(2)])
      return { ...a, ...b }
    },
    async analyzeYearSentiment(report: ReportData, sampleLines: string[]): Promise<string> {
      return transport(buildYearSentimentPrompt(report, sampleLines), 1024)
    },
    async analyzeAstro(
      friend: Friend, chart: BaziChart, fortune: DayFortune, compat: Compatibility | null,
      dayClash?: { friend: string[]; my: string[] },
    ): Promise<AstroReading> {
      const text = await transport(buildAstroPrompt(friend, chart, fortune, compat, dayClash), 1024)
      return parseAstroReading(text)
    },
    async extractBirth(friend: Friend, samples: string[]): Promise<BirthInfo | null> {
      const text = await transport(buildBirthExtractPrompt(friend, samples), 256)
      return parseBirthInfo(text)
    },
    async extractStocks(friend: Friend, samples: string[], ctx: ExtractCtx): Promise<StockPick[]> {
      const text = await transport(buildStockExtractionPrompt(friend, samples), 2048)
      return parseStockExtraction(text, ctx)
    },
    async answerChatQa(question: string, history: ChatQaTurn[], context: ChatQaContext): Promise<string> {
      const text = await transport(buildChatQaPrompt(question, history, context), 2048)
      return parseChatQaAnswer(text)
    },
  }
}

// —— 后端 A：云函数 —— //
const cloudTransport: Transport = async (prompt, maxTokens, model) => {
  // 惰性访问 wx，避免模块顶层触发
  const res = await wx.cloud.callFunction({ name: 'aiProxy', data: { prompt, maxTokens, model } })
  const r = res.result as { text?: string; error?: string }
  if (r.error) throw new Error(r.error)
  return r.text ?? ''
}

// —— 后端 B：公司服务器 HTTPS 反代 —— //
// __AI_PROXY_URL__ 必须由构建期 vite define 注入（非运行时），后端 B 才生效。
const PROXY_URL = (globalThis as any).__AI_PROXY_URL__ ?? ''
const proxyTransport: Transport = (prompt, maxTokens, model) => new Promise((resolve, reject) => {
  // 惰性访问 wx，避免模块顶层触发
  wx.request({
    url: PROXY_URL, method: 'POST',
    header: { 'content-type': 'application/json' },
    data: { prompt, maxTokens, model },
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
