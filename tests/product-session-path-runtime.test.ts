import { describe, expect, it } from 'vitest'
import { isProjectCwdWithinRoot } from '../src/shared/productSessionPathRuntime'

describe('product session project path boundaries', () => {
  it.each([
    ['/srv/orders', '/srv/orders', true],
    ['/srv/orders/', '/srv/orders', true],
    ['/srv/orders/', '/srv/orders/api', true],
    ['/srv/orders', '/srv/orders/api/../worker', true],
    ['/srv/orders', '/srv/orders/../billing', false],
    ['/srv/orders', '/srv/orders-archive', false],
    ['/', '/srv/orders', true],
    ['C:\\Work\\Orders\\', 'c:\\work\\orders', true],
    ['C:\\Work\\Orders', 'c:\\work\\orders\\api', true],
    ['C:\\Work\\Orders', 'c:\\work\\orders\\api\\..\\worker', true],
    ['C:\\Work\\Orders', 'C:\\Work\\Orders\\..\\Billing', false],
    ['C:\\Work\\Orders', 'C:\\Work\\Billing', false],
    ['\\\\server\\share\\orders', '\\\\SERVER\\SHARE\\orders\\api', true],
    ['\\\\server\\share\\orders', '\\\\SERVER\\SHARE\\orders\\api\\..\\worker', true],
    ['\\\\server\\share\\orders', '\\\\SERVER\\SHARE\\orders\\..\\billing', false]
  ])('checks whether %s contains %s', (projectRoot, cwd, expected) => {
    expect(isProjectCwdWithinRoot(projectRoot, cwd)).toBe(expected)
  })
})
