// 本地「聊天体」中文情感打分：纯函数，无副作用，永不抛异常。
// 词典为精简口语词表，可持续扩充；普通情绪 ±1，强烈 ±2。

const POS_STRONG = ['爱你', '爱', '太棒了', '幸福', '开心死', '感动', '喜欢你', '超喜欢', '么么', '抱抱', '想你']
const POS = ['开心', '喜欢', '谢谢', '哈哈', '嘻嘻', '嘿嘿', '棒', '好耶', '不错', '赞', '可爱', '甜', '暖', '舒服', '满足', '期待', '好的', '好呀', '嗯嗯', '晚安', '辛苦了', '加油', '放心']
const NEG_STRONG = ['难受', '崩溃', '讨厌', '滚', '恶心', '绝望', '心碎', '痛苦', '委屈', '想哭', '烦死']
const NEG = ['烦', '无聊', '累', '唉', '呜', '生气', '郁闷', '失望', '难过', '伤心', 'emmm', '算了', '无语', '尴尬', '担心', '害怕', '孤独', '别烦', '不想']

const LEX: Record<string, number> = {}
for (const w of POS_STRONG) LEX[w] = 2
for (const w of POS) LEX[w] = 1
for (const w of NEG_STRONG) LEX[w] = -2
for (const w of NEG) LEX[w] = -1

const EMOJI: Record<string, number> = {
  '😄': 1, '😀': 1, '😁': 1, '🥰': 2, '😍': 2, '❤️': 2, '💕': 2, '😂': 1, '🤣': 1, '😊': 1, '👍': 1, '🎉': 1, '😘': 2,
  '😭': -2, '😡': -2, '💔': -2, '😔': -1, '😞': -1, '😢': -1, '😰': -1, '😩': -1, '🙁': -1, '😖': -1,
}

const NEG_WORDS = ['不', '没', '别', '无', '非', '莫']

// 词典权重 → 极性 -1..1（供词云染色）。
export function wordPolarity(word: string): number {
  const w = LEX[word]
  if (!w) return 0
  return Math.max(-1, Math.min(1, w / 2))
}

/** 消息原始净分（可正可负，无固定范围）。空串/纯符号 → 0。 */
export function scoreMessage(text: string): number {
  if (!text) return 0
  let score = 0

  // 情绪词（含否定翻转：词首前 2 字窗口内有否定词则取反）
  for (const word in LEX) {
    let idx = text.indexOf(word)
    while (idx !== -1) {
      const window = text.slice(Math.max(0, idx - 2), idx)
      const negated = NEG_WORDS.some((n) => window.includes(n))
      score += negated ? -LEX[word] : LEX[word]
      idx = text.indexOf(word, idx + word.length)
    }
  }

  // emoji
  for (const e in EMOJI) {
    let idx = text.indexOf(e)
    while (idx !== -1) { score += EMOJI[e]; idx = text.indexOf(e, idx + e.length) }
  }

  // 重复启发式：哈{2,}/嘻嘻/嘿嘿 → +1；呜{2,}/emmm → -1
  if (/哈哈+|嘻嘻|嘿嘿/.test(text)) score += 1
  if (/呜呜+|em+/i.test(text)) score -= 1

  // 感叹号放大同号强度（每个 !/！ ×1.2，封顶 ×2）
  const bangs = (text.match(/[!！]/g) || []).length
  if (bangs > 0 && score !== 0) {
    score *= Math.min(2, 1 + bangs * 0.2)
  }

  return score
}

export function classify(raw: number): '开心' | '平淡' | '难过' {
  if (raw > 0.5) return '开心'
  if (raw < -0.5) return '难过'
  return '平淡'
}

const R = 3
export function toValue(raw: number): number {
  const clamped = Math.max(-R, Math.min(R, raw))
  return 0.5 + clamped / (2 * R)
}
