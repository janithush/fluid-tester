import { describe, it, expect, vi } from 'vitest'
import { getStatusVisual } from '@/lib/status-colors'

describe('getStatusVisual (status -> color mapping)', () => {
  it('maps GOOD to green', () => {
    const v = getStatusVisual('GOOD')
    expect(v.color).toBe('green')
    expect(v.label).toBe('GOOD')
  })

  it('maps NORMAL to green (alias for GOOD)', () => {
    const v = getStatusVisual('NORMAL')
    expect(v.color).toBe('green')
  })

  it('maps WARNING to yellow', () => {
    const v = getStatusVisual('WARNING')
    expect(v.color).toBe('yellow')
    expect(v.label).toBe('WARNING')
  })

  it('maps BAD to yellow (alias for WARNING)', () => {
    const v = getStatusVisual('BAD')
    expect(v.color).toBe('yellow')
  })

  it('maps CRITICAL to red', () => {
    const v = getStatusVisual('CRITICAL')
    expect(v.color).toBe('red')
    expect(v.label).toBe('CRITICAL')
  })

  it('accepts lowercase input and normalizes', () => {
    expect(getStatusVisual('good').color).toBe('green')
    expect(getStatusVisual('critical').color).toBe('red')
    expect(getStatusVisual('warning').color).toBe('yellow')
  })

  it('maps ERROR to gray', () => {
    expect(getStatusVisual('ERROR').color).toBe('gray')
  })

  it('maps null and undefined to gray (error fallback)', () => {
    expect(getStatusVisual(null).color).toBe('gray')
    expect(getStatusVisual(undefined).color).toBe('gray')
  })

  it('maps unknown status to gray and warns the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const v = getStatusVisual('WHO_KNOWS')
    expect(v.color).toBe('gray')
    expect(v.label).toBe('UNKNOWN')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns the full StatusVisual (bgClass, textClass, borderClass, glowClass, dotHex, label)', () => {
    const v = getStatusVisual('GOOD')
    expect(v.bgClass).toContain('emerald')
    expect(v.textClass).toContain('emerald')
    expect(v.borderClass).toContain('emerald')
    expect(v.glowClass).toBe('glow-green')
    expect(v.dotHex).toMatch(/^#[0-9a-f]{6}$/i)
    expect(v.label).toBe('GOOD')
  })
})
