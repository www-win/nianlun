export interface AiSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>

type Content =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >

async function requestMessages(
  content: Content,
  maxTokens: number,
  settings: AiSettings,
  fetchImpl: FetchLike,
): Promise<string> {
  const url = settings.baseUrl.replace(/\/+$/, '') + '/v1/messages'

  let resp: { ok: boolean; status: number; json: () => Promise<any> }
  try {
    resp = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content }],
      }),
    })
  } catch {
    throw new Error('无法连接 AI 服务，请检查网络或接入地址（也可能是跨域 CORS 限制）')
  }

  if (!resp.ok) {
    if (resp.status === 401) throw new Error('API Key 无效，请检查设置中的密钥')
    if (resp.status === 429) throw new Error('调用太频繁或额度已用尽，请稍后再试')
    throw new Error(`AI 服务返回错误（HTTP ${resp.status}）`)
  }

  const data = await resp.json()
  const block = Array.isArray(data?.content)
    ? data.content.find((b: any) => b?.type === 'text')
    : null
  if (!block?.text) throw new Error('AI 返回内容为空')
  return block.text as string
}

export async function generateText(
  prompt: string,
  settings: AiSettings,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  return requestMessages(prompt, 1024, settings, fetchImpl)
}

export async function extractFromImage(
  image: { base64: string; mediaType: string },
  prompt: string,
  settings: AiSettings,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const content: Content = [
    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
    { type: 'text', text: prompt },
  ]
  return requestMessages(content, 4096, settings, fetchImpl)
}
