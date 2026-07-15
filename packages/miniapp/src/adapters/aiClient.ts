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

// 严格 JSON 类分析首解析为空时，追加这段提示重试一次，压掉模型偶发的截断/格式波动。
const RETRY_HINT = '\n\n注意：上一次未能得到有效结果。请务必只输出一个完整、闭合的 JSON 对象，不要截断、不要多余文字。'

/** 调 transport 解析一次；结果被判为空则追加提示重试一次（最多两次调用）。 */
async function withRetry<T>(
  transport: Transport, prompt: string, maxTokens: number,
  parse: (text: string) => T, isEmpty: (v: T) => boolean, model?: string,
): Promise<T> {
  const first = parse(await transport(prompt, maxTokens, model))
  if (!isEmpty(first)) return first
  return parse(await transport(prompt + RETRY_HINT, maxTokens, model))
}

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
      // 画像 5 侧面 + 投资子维度字段多，1024 易被截断 → 2048；首解析为空重试一次。
      return withRetry(
        transport, buildFriendProfilePrompt(friend, samples), 2048,
        parseFriendProfile, (p) => Object.keys(p).length === 0,
      )
    },
    async analyzeFriendMbti(friend: Friend, samples: string[]): Promise<MbtiResult | null> {
      // code+title+summary(60~100字)+4 维度各带一句 note，中文重，768 易被截断 → 1536；首解析为空重试一次。
      return withRetry(
        transport, buildMbtiPrompt(friend, samples), 1536,
        parseMbti, (r) => r === null,
      )
    },
    async analyzeRelationDeep(friend: Friend, samples: string[]): Promise<RelationDeep> {
      // 单次全量 10 块生成会撞云函数 60s 硬顶(-504003)，故拆 3 段（各 3~4 块）。
      // 关键：三段**串行**逐个发——并行会同时打多个请求，超出 GACCODE 代理并发上限的
      // 会被上游挂住不回→50s 超时（单请求的「好友画像」从不中招即为佐证）。样本限量 20 条、
      // 不指定 model 走云函数默认。客户端浅合并（三段字段不相交）。
      const capped = samples.slice(0, 20)
      const out: RelationDeep = {}
      for (const p of [1, 2, 3] as const) {
        try {
          const seg = await transport(buildRelationDeepPrompt(friend, capped, p), 1536).then(parseRelationDeep)
          Object.assign(out, seg)
        } catch {
          // 某段挂起/失败（如敏感内容触发上游安全机制）：跳过，保留其它段——
          // 宁可给出 7/10 块的部分分析，也不整个失败。
        }
      }
      return out
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
