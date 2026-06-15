import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

const sourceFile = resolve('resources/app-icon-source.png')
const outputDir = resolve('resources/icons')
const sizes = [16, 32, 48, 64, 128, 256, 512]

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i += 1) {
  let c = i
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[i] = c >>> 0
}

const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

const paethPredictor = (left, above, upperLeft) => {
  const p = left + above - upperLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - above)
  const pc = Math.abs(p - upperLeft)
  if (pa <= pb && pa <= pc) return left
  if (pb <= pc) return above
  return upperLeft
}

const readPngRgba = (file) => {
  const fileBuffer = readFileSync(file)
  if (!fileBuffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`${file} is not a PNG file.`)
  }

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idatChunks = []
  let offset = pngSignature.length

  while (offset < fileBuffer.length) {
    const length = fileBuffer.readUInt32BE(offset)
    const type = fileBuffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = fileBuffer.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`${file} must be an 8-bit non-interlaced RGB or RGBA PNG.`)
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3
  const stride = width * bytesPerPixel
  const inflated = inflateSync(Buffer.concat(idatChunks))
  const rgba = Buffer.alloc(width * height * 4)
  let inputOffset = 0
  let outputOffset = 0
  const previous = Buffer.alloc(stride)
  const current = Buffer.alloc(stride)

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset]
    inputOffset += 1
    inflated.copy(current, 0, inputOffset, inputOffset + stride)
    inputOffset += stride

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0
      const above = previous[x] || 0
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] || 0 : 0
      if (filter === 1) {
        current[x] = (current[x] + left) & 0xff
      } else if (filter === 2) {
        current[x] = (current[x] + above) & 0xff
      } else if (filter === 3) {
        current[x] = (current[x] + Math.floor((left + above) / 2)) & 0xff
      } else if (filter === 4) {
        current[x] = (current[x] + paethPredictor(left, above, upperLeft)) & 0xff
      } else if (filter !== 0) {
        throw new Error(`${file} contains unsupported PNG filter ${filter}.`)
      }
    }

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = x * bytesPerPixel
      rgba[outputOffset] = current[pixelOffset]
      rgba[outputOffset + 1] = current[pixelOffset + 1]
      rgba[outputOffset + 2] = current[pixelOffset + 2]
      rgba[outputOffset + 3] = colorType === 6 ? current[pixelOffset + 3] : 255
      outputOffset += 4
    }

    current.copy(previous)
  }

  return { width, height, rgba }
}

const sampleBilinear = (source, x, y) => {
  const left = Math.max(0, Math.min(source.width - 1, Math.floor(x)))
  const top = Math.max(0, Math.min(source.height - 1, Math.floor(y)))
  const right = Math.max(0, Math.min(source.width - 1, left + 1))
  const bottom = Math.max(0, Math.min(source.height - 1, top + 1))
  const tx = x - left
  const ty = y - top
  const out = [0, 0, 0, 0]

  for (let channel = 0; channel < 4; channel += 1) {
    const topLeft = source.rgba[(top * source.width + left) * 4 + channel]
    const topRight = source.rgba[(top * source.width + right) * 4 + channel]
    const bottomLeft = source.rgba[(bottom * source.width + left) * 4 + channel]
    const bottomRight = source.rgba[(bottom * source.width + right) * 4 + channel]
    const topMix = topLeft + (topRight - topLeft) * tx
    const bottomMix = bottomLeft + (bottomRight - bottomLeft) * tx
    out[channel] = Math.round(topMix + (bottomMix - topMix) * ty)
  }

  return out
}

const resizeSquare = (source, size) => {
  const output = Buffer.alloc(size * size * 4)
  const cropSize = Math.min(source.width, source.height)
  const cropX = (source.width - cropSize) / 2
  const cropY = (source.height - cropSize) / 2

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = cropX + ((x + 0.5) * cropSize) / size - 0.5
      const sourceY = cropY + ((y + 0.5) * cropSize) / size - 0.5
      const [r, g, b, a] = sampleBilinear(source, sourceX, sourceY)
      const offset = (y * size + x) * 4
      output[offset] = r
      output[offset + 1] = g
      output[offset + 2] = b
      output[offset + 3] = a
    }
  }

  return output
}

const writePng = (size, rgba) => {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let inputOffset = 0
  let outputOffset = 0

  for (let y = 0; y < size; y += 1) {
    raw[outputOffset] = 0
    outputOffset += 1
    rgba.copy(raw, outputOffset, inputOffset, inputOffset + size * 4)
    inputOffset += size * 4
    outputOffset += size * 4
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0

  return Buffer.concat([
    pngSignature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const source = readPngRgba(sourceFile)

mkdirSync(outputDir, { recursive: true })
for (const size of sizes) {
  const file = resolve(outputDir, `${size}x${size}.png`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, writePng(size, resizeSquare(source, size)))
  console.log(`wrote ${file}`)
}
