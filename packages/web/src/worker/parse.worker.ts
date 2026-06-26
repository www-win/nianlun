import { parseFile, aggregate, buildReport, mergeConversations, extractFriendSamples } from '@nianlun/core'
import type { ParseRequest, ParseResponse } from './protocol'

self.onmessage = (ev: MessageEvent<ParseRequest>) => {
  const post = (msg: ParseResponse) => (self as unknown as Worker).postMessage(msg)
  try {
    const { files, year } = ev.data
    let conversations: ReturnType<typeof parseFile>['conversations'] = []
    const warnings: string[] = []
    files.forEach((f, i) => {
      const r = parseFile(f.name, f.content)
      conversations = mergeConversations(conversations, r.conversations)
      r.warnings.forEach((w) => warnings.push(`${f.name}: ${w.reason}`))
      post({ type: 'progress', value: (i + 1) / files.length })
    })
    const friends = aggregate(conversations)
    const report = buildReport(conversations, friends, year)
    // 截取有界的聊天样本随结果带回主线程；原始 Conversation[] 绝不离开 Worker。
    const samples = extractFriendSamples(conversations)
    post({ type: 'done', friends, report, warnings, samples })
  } catch (e) {
    post({ type: 'error', message: (e as Error).message })
  }
}
