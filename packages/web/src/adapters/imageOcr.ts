import { extractFromImage, type AiSettings, type FetchLike } from './aiClient'
import type { ReadFile } from './fileReader'

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i

export function isImageFile(file: File): boolean {
  return IMAGE_EXT.test(file.name) || file.type.startsWith('image/')
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function buildPrompt(year: number): string {
  return [
    '这是一张微信聊天截图。请把其中的对话逐条提取成纯文本。',
    '严格按以下格式输出，不要任何解释或前后缀：',
    '每条消息一个块，首行是 `YYYY-MM-DD HH:MM:SS 发送者`，下一行起是正文，块之间用一个空行分隔。',
    '右侧气泡的发送者写「我」；左侧气泡写对方昵称（取自顶部标题栏）。',
    `时间用截图中可见的日期/时间；若某条看不到日期，用 ${year} 年并沿用最近一次可见的时间。`,
    '只输出符合上述格式的文本。',
  ].join('\n')
}

function stripFences(text: string): string {
  const t = text.trim()
  const fenced = t.match(/^```[\w]*\r?\n([\s\S]*?)\r?\n?```$/)
  return (fenced ? fenced[1] : t).trim()
}

export async function ocrImage(
  file: File,
  year: number,
  settings: AiSettings,
  fetchImpl: FetchLike = fetch,
): Promise<ReadFile> {
  const dataUrl = await fileToDataUrl(file)
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(0, comma)
  const base64 = dataUrl.slice(comma + 1)
  const mediaType = meta.match(/data:(.*?);base64/)?.[1] || 'image/png'

  const text = await extractFromImage({ base64, mediaType }, buildPrompt(year), settings, fetchImpl)
  return { name: file.name, content: stripFences(text) }
}
