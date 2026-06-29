declare namespace Intl {
  interface SegmentData {
    segment: string
    index: number
    isWordLike?: boolean
  }
  interface Segments {
    [Symbol.iterator](): IterableIterator<SegmentData>
  }
  interface Segmenter {
    segment(input: string): Segments
  }
  const Segmenter: {
    new (
      locales?: string | string[],
      options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
    ): Segmenter
  }
}
