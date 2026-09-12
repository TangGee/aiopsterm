import { describe, expect, it } from 'vitest'
import { incompatibleLinuxRuntimeVersions } from '../scripts/linux-runtime-baseline.mjs'

const needs = (...versions: string[]) => `Version needs section '.gnu.version_r' contains 2 entries:\n${versions.map((v) => `  Name: ${v} Flags: none Version: 4`).join('\n')}`

describe('Ubuntu 20.04 runtime ABI baseline', () => {
  it('accepts the stock updated Ubuntu 20.04 C and C++ runtimes', () => {
    expect(incompatibleLinuxRuntimeVersions(needs('GLIBC_2.31', 'GLIBCXX_3.4.28', 'CXXABI_1.3.12'))).toEqual([])
  })

  it('rejects GCC 11 SQLite binaries even when their glibc requirement is compatible', () => {
    expect(incompatibleLinuxRuntimeVersions(needs('GLIBC_2.29', 'GLIBCXX_3.4.29'))).toEqual(['GLIBCXX_3.4.29'])
  })

  it('checks every ABI family and reports its highest required version once', () => {
    expect(incompatibleLinuxRuntimeVersions(needs('GLIBC_2.9', 'GLIBC_2.34', 'GLIBCXX_3.4.30', 'GLIBCXX_3.4.29', 'CXXABI_1.3.13', 'GLIBC_2.34')))
      .toEqual(['GLIBC_2.34', 'GLIBCXX_3.4.30', 'CXXABI_1.3.13'])
  })

  it('does not mistake exported symbol definitions for host requirements', () => {
    expect(incompatibleLinuxRuntimeVersions("Version definition section '.gnu.version_d' contains 1 entry:\n Name: GLIBCXX_3.4.32\n" + needs('GLIBC_2.28'))).toEqual([])
  })

  it('accepts binaries without versioned dynamic dependencies', () => {
    expect(incompatibleLinuxRuntimeVersions('No version information found in this file.')).toEqual([])
  })
})
