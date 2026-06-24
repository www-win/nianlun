import { describe, it, expect } from 'vitest'
import { version } from '../index'

describe('core package', () => {
  it('exports a version string', () => {
    expect(version).toBe('0.1.0')
  })
})
