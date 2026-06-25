export interface ReadFile {
  name: string
  content: string
}

export async function readTextFile(file: File): Promise<ReadFile> {
  try {
    const content = await file.text()
    return { name: file.name, content }
  } catch (e) {
    throw new Error(`无法读取文件 ${file.name}: ${(e as Error).message}`)
  }
}
