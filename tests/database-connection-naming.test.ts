import { describe, expect, it } from 'vitest'
import {
  databaseConnectionEndpoint,
  databaseFileNameFromPath,
  oracleServiceNameFromUrl,
  suggestedDatabaseConnectionName,
  uniqueDatabaseConnectionName
} from '@shared/databaseConnectionNaming'
import type { DatabaseEngineCode } from '@shared/contracts/database'

describe('database connection naming', () => {
  it('derives stable endpoint names for every network database engine', () => {
    const engines: DatabaseEngineCode[] = [
      'mysql',
      'mariadb',
      'oceanbase',
      'postgresql',
      'kingbase',
      'oracle',
      'sqlserver',
      'clickhouse',
      'presto'
    ]

    engines.forEach((dbType) => {
      expect(suggestedDatabaseConnectionName({ dbType, host: 'db.example.test', port: 5432, database: 'operations' })).toBe(
        'operations@db.example.test:5432'
      )
      expect(suggestedDatabaseConnectionName({ dbType, host: 'db.example.test', port: 5432 })).toBe(`${dbType}@db.example.test:5432`)
    })
  })

  it('handles SQLite and Oracle paths while keeping display names unique', () => {
    expect(databaseFileNameFromPath('/srv/data/youtube_downloads.db')).toBe('youtube_downloads.db')
    expect(suggestedDatabaseConnectionName({ dbType: 'sqlite', database: 'legacy.sqlite3' })).toBe('legacy.sqlite3')
    expect(suggestedDatabaseConnectionName({ dbType: 'sqlite', url: 'sqlite:///srv/data/url-only.db' })).toBe('url-only.db')
    expect(databaseFileNameFromPath('C:\\Users\\ops\\state_5.sqlite')).toBe('state_5.sqlite')
    expect(suggestedDatabaseConnectionName({ dbType: 'sqlite', filePath: '/srv/data/youtube_downloads.db' })).toBe('youtube_downloads.db')
    expect(databaseConnectionEndpoint({ dbType: 'oracle', url: 'jdbc:oracle:thin:@//oracle.internal:1521/ORCLPDB1' })).toBe('oracle.internal:1521')
    expect(oracleServiceNameFromUrl('oracle.internal:1522/ORCLPDB2')).toBe('ORCLPDB2')
    expect(oracleServiceNameFromUrl('oracle.internal:1522')).toBe('')
    expect(
      suggestedDatabaseConnectionName({
        dbType: 'oracle',
        database: 'STALEPDB',
        url: 'jdbc:oracle:thin:@//oracle.internal:1521/ORCLPDB1'
      })
    ).toBe('ORCLPDB1@oracle.internal:1521')
    expect(
      suggestedDatabaseConnectionName({
        dbType: 'oracle',
        host: 'stale.internal',
        port: 1521,
        database: 'STALEPDB',
        url: 'oracle.internal:1522/ORCLPDB2'
      })
    ).toBe('ORCLPDB2@oracle.internal:1522')
    expect(
      databaseConnectionEndpoint({
        dbType: 'postgresql',
        host: 'actual.internal',
        port: 5432,
        url: 'jdbc:postgresql://display-only.internal:15432/orders'
      })
    ).toBe('actual.internal:5432')
    expect(uniqueDatabaseConnectionName('orders@db.internal:5432', ['ORDERS@DB.INTERNAL:5432', 'orders@db.internal:5432-2'])).toBe(
      'orders@db.internal:5432-3'
    )
  })
})
