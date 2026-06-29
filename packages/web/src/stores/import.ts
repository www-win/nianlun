import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import { mergeFriends, applyContactNames, parseWeliveContacts, isWeliveContacts } from '@nianlun/core'
import { readTextFile } from '../adapters/fileReader'
import { parseFiles } from '../adapters/parseClient'
import { isImageFile, ocrImage } from '../adapters/imageOcr'
import { useDataStore } from './data'
import { useSettingsStore } from './settings'

export type ImportStatus = 'idle' | 'parsing' | 'done' | 'error'

export const useImportStore = defineStore('import', () => {
  const status = ref<ImportStatus>('idle')
  const progress = ref(0)
  const warnings = ref<string[]>([])
  const error = ref('')
  // 聊天样本仅存内存（键为 friend id），绝不写入 IndexedDB；刷新即失。
  const friendSamples = ref<Record<string, string[]>>({})

  async function run(files: File[], year: number) {
    status.value = 'parsing'
    progress.value = 0
    warnings.value = []
    error.value = ''
    try {
      const settings = useSettingsStore()
      const ocrWarnings: string[] = []

      const images = files.filter(isImageFile)
      if (images.length && !settings.isConfigured) {
        throw new Error('图片识别需要先在"设置"里配置 AI（视觉模型）后再试。')
      }

      // 分流：图片走 OCR，文本直接读取
      const readPromises = files.map(async (file) => {
        if (isImageFile(file)) {
          try {
            return await ocrImage(file, year, {
              baseUrl: settings.baseUrl,
              apiKey: settings.apiKey,
              model: settings.model,
            })
          } catch (e) {
            ocrWarnings.push(`${file.name}: OCR 失败 —— ${(e as Error).message}`)
            return null
          }
        }
        return readTextFile(file)
      })

      const results = await Promise.all(readPromises)
      const read = results.filter((r) => r !== null) as { name: string; content: string }[]

      // 分流：welive 联系人表(contacts.json)→名字对照；其余→聊天记录走 worker 解析
      const contactNames = read
        .filter((r) => isWeliveContacts(r.content.slice(0, 2000)))
        .flatMap((r) => parseWeliveContacts(r.content))
      const chatFiles = read.filter((r) => !isWeliveContacts(r.content.slice(0, 2000)))
      const appliedCount = (fs: { id: string }[]) => {
        const ids = new Set(contactNames.map((n) => n.id))
        return fs.filter((f) => ids.has(f.id)).length
      }
      const contactWarn = (n: number) => (contactNames.length ? [`已套用联系人名字 ${n} 个`] : [])

      const data = useDataStore()
      if (chatFiles.length || contactNames.length === 0) {
        const outcome = await parseFiles(chatFiles, year, { onProgress: (p) => { progress.value = p } })
        // 合并进已有好友,保留用户编辑;再用联系人表套真名(无联系人则 no-op)
        const merged = mergeFriends(data.friends, outcome.friends)
        // toRaw：避免把 Vue 响应式代理喂给 applyContactNames(浅展开后嵌套数组仍是代理,无法结构化克隆入库)
        const named = applyContactNames(merged.friends.map(toRaw), contactNames)
        await data.setData(named, outcome.report)
        // 合并本次样本进内存（后到的覆盖同 id 的旧样本），不持久化。
        friendSamples.value = { ...friendSamples.value, ...outcome.samples }
        warnings.value = [...ocrWarnings, ...outcome.warnings, ...contactWarn(appliedCount(named))]
      } else {
        // 只导了 contacts.json：给已有好友套名
        if (!data.report) {
          throw new Error('请先导入聊天记录,再导入联系人 contacts.json。')
        }
        const named = applyContactNames(data.friends.map(toRaw), contactNames)
        await data.setData(named, toRaw(data.report))
        progress.value = 1
        warnings.value = [...ocrWarnings, ...contactWarn(appliedCount(data.friends))]
      }
      status.value = 'done'
    } catch (e) {
      error.value = (e as Error).message
      status.value = 'error'
    }
  }

  function reset() {
    status.value = 'idle'
    progress.value = 0
    warnings.value = []
    error.value = ''
  }

  function samplesFor(friendId: string): string[] {
    return friendSamples.value[friendId] ?? []
  }

  return { status, progress, warnings, error, friendSamples, run, reset, samplesFor }
})
