/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 预置的 AI 接入地址，例如 https://api.gaccode.com */
  readonly VITE_AI_BASE_URL?: string
  /** 预置的 AI API Key（注意：纯前端应用会打包暴露） */
  readonly VITE_AI_API_KEY?: string
  /** 预置的模型名，留空则用代码默认值 */
  readonly VITE_AI_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
