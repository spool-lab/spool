import { describe, it, expect } from 'vitest'
import {
  normalizeCombo,
  eventToCombo,
  dispatchHotkey,
  type HotkeyLayer,
} from './useHotkeys.js'

function layer(bindings: Record<string, () => void>, modal = false): HotkeyLayer {
  return {
    bindingsRef: { current: bindings },
    modalRef: { current: modal },
  }
}

describe('normalizeCombo', () => {
  it('lowercases and sorts modifiers consistently', () => {
    expect(normalizeCombo('Shift+Meta+K', true)).toBe('meta+shift+k')
    expect(normalizeCombo('K+Meta+Shift', true)).toBe('meta+shift+k')
  })

  it('resolves `mod` to meta on mac, ctrl elsewhere', () => {
    expect(normalizeCombo('mod+k', true)).toBe('meta+k')
    expect(normalizeCombo('mod+k', false)).toBe('ctrl+k')
  })

  it('accepts alias modifiers', () => {
    expect(normalizeCombo('cmd+k', true)).toBe('meta+k')
    expect(normalizeCombo('command+k', true)).toBe('meta+k')
    expect(normalizeCombo('control+k', false)).toBe('ctrl+k')
    expect(normalizeCombo('option+k', true)).toBe('alt+k')
  })

  it('aliases arrow + esc keys', () => {
    expect(normalizeCombo('mod+left', true)).toBe('meta+arrowleft')
    expect(normalizeCombo('Esc', true)).toBe('escape')
  })
})

describe('eventToCombo', () => {
  it('builds combo string from KeyboardEvent fields', () => {
    expect(eventToCombo({
      ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'k',
    })).toBe('meta+k')
  })

  it('omits modifier keys when pressed alone', () => {
    expect(eventToCombo({
      ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'Meta',
    })).toBe('meta')
  })

  it('orders modifiers same as normalizeCombo so they match', () => {
    const event = { ctrlKey: false, metaKey: true, altKey: false, shiftKey: true, key: 'K' }
    expect(eventToCombo(event)).toBe(normalizeCombo('mod+shift+k', true))
  })

  it('aliases ArrowLeft → arrowleft', () => {
    expect(eventToCombo({
      ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'ArrowLeft',
    })).toBe('meta+arrowleft')
  })
})

describe('dispatchHotkey', () => {
  it('returns the matching handler from the top layer', () => {
    const fn = () => {}
    const result = dispatchHotkey('escape', [layer({ escape: fn })])
    expect(result).toEqual({ kind: 'handled', layerIndex: 0, handler: fn })
  })

  it('top layer wins over lower layer for the same combo', () => {
    const lower = () => {}
    const upper = () => {}
    const result = dispatchHotkey('escape', [
      layer({ escape: lower }),
      layer({ escape: upper }),
    ])
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.handler).toBe(upper)
      expect(result.layerIndex).toBe(1)
    }
  })

  it('falls through to lower layer when top has no binding (non-modal)', () => {
    const lower = () => {}
    const result = dispatchHotkey('meta+k', [
      layer({ 'meta+k': lower }),
      layer({ escape: () => {} }), // top layer, no meta+k
    ])
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.handler).toBe(lower)
      expect(result.layerIndex).toBe(0)
    }
  })

  it('modal layer swallows unbound combos so they do not fall through', () => {
    const lower = () => {}
    const result = dispatchHotkey('meta+k', [
      layer({ 'meta+k': lower }),
      layer({ escape: () => {} }, true), // modal
    ])
    expect(result).toEqual({ kind: 'swallowed' })
  })

  it('modal layer still serves its own bindings before swallowing', () => {
    const lowerFn = () => {}
    const modalEsc = () => {}
    const result = dispatchHotkey('escape', [
      layer({ 'meta+k': lowerFn }),
      layer({ escape: modalEsc }, true),
    ])
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') expect(result.handler).toBe(modalEsc)
  })

  it('returns unhandled when no layer binds the combo', () => {
    const result = dispatchHotkey('meta+x', [layer({ escape: () => {} })])
    expect(result).toEqual({ kind: 'unhandled' })
  })

  it('returns unhandled on empty stack', () => {
    expect(dispatchHotkey('escape', [])).toEqual({ kind: 'unhandled' })
  })
})
