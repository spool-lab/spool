import { describe, expect, it } from 'vitest'
import { getSessionResumeCommand, getSessionResumeCommandPrefix } from './resumeCommand.js'

describe('getSessionResumeCommandPrefix', () => {
  it('returns the configured CLI prefix for resumable session sources', () => {
    expect(getSessionResumeCommandPrefix('claude')).toBe('claude --resume')
    expect(getSessionResumeCommandPrefix('codex')).toBe('codex resume')
    expect(getSessionResumeCommandPrefix('gemini')).toBe('gemini --resume')
  })

  it('returns null for unsupported sources', () => {
    expect(getSessionResumeCommandPrefix('opencli')).toBeNull()
    expect(getSessionResumeCommandPrefix('unknown-cli')).toBeNull()
  })
})

describe('getSessionResumeCommand', () => {
  it('builds the full shell command with a quoted session id', () => {
    expect(getSessionResumeCommand('claude', 'test-session-uuid')).toBe("claude --resume 'test-session-uuid'")
    expect(getSessionResumeCommand('codex', '11111111-2222-4333-8444-555555555555')).toBe("codex resume '11111111-2222-4333-8444-555555555555'")
    expect(getSessionResumeCommand('gemini', '99999999-2222-4333-8444-555555555555')).toBe("gemini --resume '99999999-2222-4333-8444-555555555555'")
  })

  it('escapes embedded single quotes safely', () => {
    expect(getSessionResumeCommand('claude', "session'with'quotes")).toBe("claude --resume 'session'\\''with'\\''quotes'")
  })
})
