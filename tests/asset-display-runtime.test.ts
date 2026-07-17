import { describe, expect, it } from 'vitest'

import { managedAssetDisplayName, managedAssetEndpoint } from '@shared/assetDisplayRuntime'

describe('managed asset display runtime', () => {
  it('uses the managed title/name before connection coordinates', () => {
    expect(managedAssetDisplayName({
      id: 'asset-prod',
      title: 'Production gateway',
      name: 'prod-gateway',
      host: 'prod.internal',
      ip: '10.0.0.8'
    })).toBe('Production gateway')
    expect(managedAssetDisplayName({
      id: 'asset-prod',
      title: '  ',
      name: 'prod-gateway',
      host: 'prod.internal',
      ip: '10.0.0.8'
    })).toBe('prod-gateway')
    expect(managedAssetDisplayName({
      id: 'asset-prod',
      title: '',
      name: '',
      host: 'prod.internal',
      ip: '10.0.0.8'
    })).toBe('prod.internal')
    expect(managedAssetDisplayName({
      id: 'asset-prod',
      title: '',
      name: '',
      host: '',
      ip: '10.0.0.8'
    })).toBe('10.0.0.8')
    expect(managedAssetDisplayName({ id: 'asset-prod' })).toBe('asset-prod')
  })

  it('uses only host then IP for the secondary endpoint label', () => {
    expect(managedAssetEndpoint({ host: 'prod.internal', ip: '10.0.0.8' })).toBe('prod.internal')
    expect(managedAssetEndpoint({ host: '  ', ip: '10.0.0.8' })).toBe('10.0.0.8')
    expect(managedAssetEndpoint({ host: '', ip: '' })).toBe('')
  })
})
