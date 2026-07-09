// 仅声明本项目用到的 wx API，避免引入完整 @types/wechat。
export interface ChosenFile { path: string; name: string; size: number }
export interface WxStat { isDirectory(): boolean; size: number }
export interface FileSystemManager {
  // 带 encoding → 文本(string)；不带 encoding → 二进制(ArrayBuffer)。
  readFile(opts: {
    filePath: string; encoding: string
    success?: (res: { data: string }) => void
    fail?: (err: { errMsg: string }) => void
  }): void
  readFile(opts: {
    filePath: string
    success?: (res: { data: ArrayBuffer }) => void
    fail?: (err: { errMsg: string }) => void
  }): void
  unzip(opts: {
    zipFilePath: string; targetPath: string
    success?: () => void
    fail?: (err: { errMsg: string }) => void
  }): void
  readdirSync(dirPath: string): string[]
  statSync(path: string): WxStat
  readFileSync(path: string, encoding: string): string
  writeFileSync(filePath: string, data: string, encoding: string): void
  mkdirSync(dirPath: string, recursive?: boolean): void
  unlinkSync(filePath: string): void
  accessSync(path: string): void
  rmdirSync(dirPath: string, recursive?: boolean): void
}
declare global {
  const wx: {
    chooseMessageFile(opts: {
      count: number; type?: 'all' | 'file'
      success?: (res: { tempFiles: ChosenFile[] }) => void
      fail?: (err: { errMsg: string }) => void
    }): void
    getFileSystemManager(): FileSystemManager
    env: { USER_DATA_PATH: string }
    setStorageSync(key: string, data: unknown): void
    getStorageSync(key: string): unknown
    removeStorageSync(key: string): void
    getStorageInfoSync(): { keys: string[]; currentSize: number; limitSize: number }
    cloud: {
      init(opts: { env: string }): void
      callFunction(opts: { name: string; data: unknown }): Promise<{ result: unknown }>
    }
    request(opts: {
      url: string; method?: string; data?: unknown; header?: Record<string, string>
      success?: (res: { statusCode: number; data: unknown }) => void
      fail?: (err: { errMsg: string }) => void
    }): void
    canvasToTempFilePath(opts: object, comp?: unknown): void
    saveImageToPhotosAlbum(opts: { filePath: string; success?: () => void; fail?: (e: unknown) => void }): void
    showModal(opts: { title?: string; content: string; success?: (r: { confirm: boolean }) => void }): void
  }
}
