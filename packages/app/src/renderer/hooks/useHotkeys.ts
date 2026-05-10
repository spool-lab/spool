import { useEffect, useRef } from 'react'

// Stack-based hotkey dispatcher.
//
// - Top layer is consulted first; first match wins.
// - A `modal` layer also blocks unbound combos from falling through to lower
//   layers (so opening Settings suppresses global ⌘K, etc.).
// - `mod` resolves to ⌘ on macOS and Ctrl elsewhere.

type Handler = (event: KeyboardEvent) => void
type Bindings = Record<string, Handler>
export type HotkeyLayer = {
  bindingsRef: { current: Bindings }
  modalRef: { current: boolean }
}

const stack: HotkeyLayer[] = []
let installed = false

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  ' ': 'space',
}

const MODIFIER_ORDER = ['ctrl', 'meta', 'alt', 'shift']

function normalizePart(part: string, mac: boolean): string {
  const p = part.trim().toLowerCase()
  if (p === 'mod') return mac ? 'meta' : 'ctrl'
  if (p === 'cmd' || p === 'command') return 'meta'
  if (p === 'control') return 'ctrl'
  if (p === 'option' || p === 'opt') return 'alt'
  return KEY_ALIASES[p] ?? p
}

function sortParts(parts: string[]): string[] {
  return [...parts].sort((a, b) => {
    const ai = MODIFIER_ORDER.indexOf(a)
    const bi = MODIFIER_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

export function normalizeCombo(combo: string, mac: boolean = isMac): string {
  return sortParts(combo.split('+').map((p) => normalizePart(p, mac))).join('+')
}

type EventLike = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>

export function eventToCombo(event: EventLike): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.metaKey) parts.push('meta')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  const raw = event.key.toLowerCase()
  if (!['control', 'meta', 'alt', 'shift'].includes(raw)) {
    parts.push(KEY_ALIASES[raw] ?? raw)
  }
  return sortParts(parts).join('+')
}

export type DispatchResult =
  | { kind: 'handled'; layerIndex: number; handler: Handler }
  | { kind: 'swallowed' }
  | { kind: 'unhandled' }

export function dispatchHotkey(combo: string, layers: HotkeyLayer[]): DispatchResult {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (!layer) continue
    const handler = layer.bindingsRef.current[combo]
    if (handler) return { kind: 'handled', layerIndex: i, handler }
    if (layer.modalRef.current) return { kind: 'swallowed' }
  }
  return { kind: 'unhandled' }
}

function install() {
  if (installed) return
  installed = true
  window.addEventListener('keydown', (event) => {
    const combo = eventToCombo(event)
    const result = dispatchHotkey(combo, stack)
    if (result.kind === 'handled') {
      event.preventDefault()
      result.handler(event)
    }
  })
}

export function useHotkeys(
  bindings: Bindings,
  options: { active?: boolean; modal?: boolean } = {},
) {
  const { active = true, modal = false } = options

  const bindingsRef = useRef<Bindings>({})
  const next: Bindings = {}
  for (const [combo, handler] of Object.entries(bindings)) {
    next[normalizeCombo(combo)] = handler
  }
  bindingsRef.current = next

  const modalRef = useRef(modal)
  modalRef.current = modal

  useEffect(() => {
    if (!active) return
    install()
    const layer: HotkeyLayer = { bindingsRef, modalRef }
    stack.push(layer)
    return () => {
      const i = stack.lastIndexOf(layer)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
