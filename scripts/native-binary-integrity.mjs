import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const MH_MAGIC_64 = 0xfeedfacf
const LC_SEGMENT_64 = 0x19
const LC_CODE_SIGNATURE = 0x1d
const MACH_HEADER_64_SIZE = 32

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export const canonicalNativeBinary = (source) => {
  if (!Buffer.isBuffer(source) || source.length < MACH_HEADER_64_SIZE || source.readUInt32LE(0) !== MH_MAGIC_64) {
    return source
  }

  const canonical = Buffer.from(source)
  const commandCount = canonical.readUInt32LE(16)
  const commandsSize = canonical.readUInt32LE(20)
  const commandsEnd = MACH_HEADER_64_SIZE + commandsSize
  if (commandsEnd > canonical.length) throw new Error('Malformed 64-bit Mach-O load command table.')

  let commandOffset = MACH_HEADER_64_SIZE
  let signatureOffset = canonical.length
  for (let index = 0; index < commandCount; index += 1) {
    if (commandOffset + 8 > commandsEnd) throw new Error('Malformed 64-bit Mach-O load command header.')
    const command = canonical.readUInt32LE(commandOffset)
    const commandSize = canonical.readUInt32LE(commandOffset + 4)
    if (commandSize < 8 || commandOffset + commandSize > commandsEnd) {
      throw new Error('Malformed 64-bit Mach-O load command size.')
    }

    if (command === LC_SEGMENT_64 && commandSize >= 72) {
      const segmentName = canonical.subarray(commandOffset + 8, commandOffset + 24).toString('ascii').replace(/\0+$/, '')
      if (segmentName === '__LINKEDIT') {
        canonical.fill(0, commandOffset + 32, commandOffset + 40)
        canonical.fill(0, commandOffset + 48, commandOffset + 56)
      }
    } else if (command === LC_CODE_SIGNATURE && commandSize >= 16) {
      const dataOffset = canonical.readUInt32LE(commandOffset + 8)
      const dataSize = canonical.readUInt32LE(commandOffset + 12)
      if (dataOffset > canonical.length || dataSize > canonical.length - dataOffset) {
        throw new Error('Malformed 64-bit Mach-O code signature range.')
      }
      signatureOffset = Math.min(signatureOffset, dataOffset)
      canonical.fill(0, commandOffset + 8, commandOffset + 16)
    }
    commandOffset += commandSize
  }
  if (commandOffset !== commandsEnd) throw new Error('Malformed 64-bit Mach-O load command table length.')

  return canonical.subarray(0, signatureOffset)
}

export const nativeBinarySha256Buffer = (source) => sha256(canonicalNativeBinary(source))

export const nativeBinarySha256 = (path) => nativeBinarySha256Buffer(readFileSync(path))
