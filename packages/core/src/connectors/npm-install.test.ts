import { describe, it, expect } from 'vitest'
import { registryUrl } from './npm-install.js'

describe('registryUrl', () => {
  it('builds correct URL for scoped package', () => {
    expect(registryUrl('@spool-lab/connector-hackernews-hot'))
      .toBe('https://registry.npmjs.org/@spool-lab%2Fconnector-hackernews-hot/latest')
  })

  it('builds correct URL for unscoped package', () => {
    expect(registryUrl('connector-foo'))
      .toBe('https://registry.npmjs.org/connector-foo/latest')
  })
})
