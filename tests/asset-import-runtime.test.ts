import { describe, expect, it } from 'vitest'
import { parseAssetImportContent } from '../src/shared/assetImport'

describe('assetImport shared parser', () => {
  it('parses generic JSON and CSV host rows', () => {
    expect(
      parseAssetImportContent(
        JSON.stringify({
          assets: [
            { label: 'json-host', ip: '10.10.1.5', username: 'ops', group_name: 'JSON', port: 2222, auth_type: 'keyBased' }
          ]
        }),
        'aiopsterm-assets.json'
      )
    ).toEqual([
      expect.objectContaining({
        title: 'json-host',
        host: '10.10.1.5',
        username: 'ops',
        group: 'JSON',
        port: 2222,
        auth_type: 'keyBased'
      })
    ])

    expect(parseAssetImportContent('label,host,username,group,port\ncsv-host,10.10.1.6,deploy,CSV,2200', 'assets.csv')).toEqual([
      expect.objectContaining({
        title: 'csv-host',
        host: '10.10.1.6',
        username: 'deploy',
        group: 'CSV',
        port: 2200
      })
    ])
  })

  it('parses XShell XSH and XTS-like text exports', () => {
    const xsh = [
      '[SessionInfo]',
      'Description=prod-shell',
      'Host=10.20.30.40',
      'Port=2222',
      'UserName=root',
      'Method=PUBLICKEY',
      'PrivateKeyFile=/home/me/.ssh/id_ed25519'
    ].join('\n')
    expect(parseAssetImportContent(xsh, 'prod.xsh')).toEqual([
      expect.objectContaining({
        title: 'prod-shell',
        host: '10.20.30.40',
        port: 2222,
        username: 'root',
        auth_type: 'keyBased'
      })
    ])

    expect(parseAssetImportContent('host=10.21.30.41:2201 user=admin\nadmin@10.21.30.41:2201', 'sessions.xts')).toEqual([
      expect.objectContaining({
        host: '10.21.30.41',
        port: 2201,
        username: 'admin'
      })
    ])
  })

  it('parses SecureCRT INI and XML sessions', () => {
    const ini = [
      '[Sessions\\secure-prod]',
      'S:"Hostname"=10.30.0.9',
      'D:"Port"=00000898',
      'S:"Username"=crtuser',
      'S:"Auth Method"=PublicKey',
      'S:"Identity Filename V2"=/keys/crt.pem'
    ].join('\n')
    expect(parseAssetImportContent(ini, 'secure.ini')).toEqual([
      expect.objectContaining({
        title: 'secure-prod',
        host: '10.30.0.9',
        port: 2200,
        username: 'crtuser',
        auth_type: 'keyBased'
      })
    ])

    const xml = '<key name="xml-prod"><string name="Hostname">10.30.0.10</string><dword name="Port">2223</dword><string name="Username">xmluser</string><string name="Auth Method">Password</string></key>'
    expect(parseAssetImportContent(xml, 'secure.xml')).toEqual([
      expect.objectContaining({
        title: 'xml-prod',
        host: '10.30.0.10',
        port: 2223,
        username: 'xmluser',
        auth_type: 'password'
      })
    ])
  })

  it('parses MobaXterm MXTSESSIONS encoded SSH rows with gateway data', () => {
    const moba = ['[Bookmarks]', 'moba-prod=#109#0%10.40.0.7%22%mobauser%%-1%10.40.0.1%2200%jumpuser%-1%2224%-1%_ProfileDir_/keys/moba.pem'].join('\n')
    expect(parseAssetImportContent(moba, 'MobaXterm.mxtsessions')).toEqual([
      expect.objectContaining({
        title: 'moba-prod',
        host: '10.40.0.7',
        username: 'mobauser',
        port: 2224,
        auth_type: 'keyBased',
        needProxy: true,
        proxyName: '10.40.0.1:2200'
      })
    ])
  })
})
