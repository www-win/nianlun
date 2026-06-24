import type { Parser, ParseResult } from '../model/types'
import { txtParser } from '../parsers/txt'
import { htmlParser } from '../parsers/html'

const PARSERS: Parser[] = [htmlParser, txtParser] // html 先嗅探(更具体)

export function parseFile(
  fileName: string,
  content: string,
  onProgress?: (p: number) => void,
): ParseResult {
  const sample = content.slice(0, 2000)
  const parser = PARSERS.find((p) => p.canParse(fileName, sample))
  if (!parser) {
    return { conversations: [], warnings: [{ reason: `无法识别的文件格式:${fileName}` }] }
  }
  return parser.parse(content, onProgress)
}
