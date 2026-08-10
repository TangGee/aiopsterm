import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalNativeBinary,
  nativeBinarySha256Buffer
} from '../scripts/native-binary-integrity.mjs'

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex')

const machOFixture = (codeByte: number, signature: string) => {
  const headerSize = 32
  const segmentSize = 72
  const signatureCommandSize = 16
  const commandsSize = segmentSize + signatureCommandSize
  const signatureOffset = headerSize + commandsSize + 16
  const signatureBuffer = Buffer.from(signature)
  const source = Buffer.alloc(signatureOffset + signatureBuffer.length)

  source.writeUInt32LE(0xfeedfacf, 0)
  source.writeUInt32LE(2, 16)
  source.writeUInt32LE(commandsSize, 20)

  source.writeUInt32LE(0x19, headerSize)
  source.writeUInt32LE(segmentSize, headerSize + 4)
  source.write('__LINKEDIT', headerSize + 8, 'ascii')
  source.writeBigUInt64LE(BigInt(source.length), headerSize + 32)
  source.writeBigUInt64LE(BigInt(signatureBuffer.length), headerSize + 48)

  const signatureCommand = headerSize + segmentSize
  source.writeUInt32LE(0x1d, signatureCommand)
  source.writeUInt32LE(signatureCommandSize, signatureCommand + 4)
  source.writeUInt32LE(signatureOffset, signatureCommand + 8)
  source.writeUInt32LE(signatureBuffer.length, signatureCommand + 12)
  source.fill(codeByte, headerSize + commandsSize, signatureOffset)
  signatureBuffer.copy(source, signatureOffset)
  return source
}

describe('native binary integrity', () => {
  it('ignores Mach-O signature payload and signature-dependent linkedit sizes', () => {
    const adHocSigned = machOFixture(0x41, 'short-signature')
    const developerIdSigned = machOFixture(0x41, 'a-much-longer-developer-id-signature')

    expect(nativeBinarySha256Buffer(adHocSigned)).toBe(nativeBinarySha256Buffer(developerIdSigned))
    expect(canonicalNativeBinary(adHocSigned).length).toBeLessThan(adHocSigned.length)
  })

  it('still detects changes to Mach-O executable content', () => {
    expect(nativeBinarySha256Buffer(machOFixture(0x41, 'signature')))
      .not.toBe(nativeBinarySha256Buffer(machOFixture(0x42, 'signature')))
  })

  it('uses the ordinary SHA-256 digest for non-Mach-O files', () => {
    const source = Buffer.from('windows-or-linux-native-runtime')
    expect(nativeBinarySha256Buffer(source)).toBe(sha256(source))
  })

  it('fails closed for malformed Mach-O load commands', () => {
    const source = Buffer.alloc(32)
    source.writeUInt32LE(0xfeedfacf, 0)
    source.writeUInt32LE(1, 16)
    source.writeUInt32LE(64, 20)
    expect(() => nativeBinarySha256Buffer(source)).toThrow('Malformed 64-bit Mach-O')
  })
})
