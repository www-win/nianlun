import { storage as defaultStorage, makeStorage } from './storage'

export function makeSamples(storage: ReturnType<typeof makeStorage> = defaultStorage) {
  return {
    loadSamplesFor(id: string): string[] {
      return storage.loadSamples()[id] ?? []
    },
  }
}

export const samples = makeSamples()
