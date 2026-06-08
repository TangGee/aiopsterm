import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const outputDir = resolve('resources/icons')
const sizes = [16, 32, 48, 64, 128, 256, 512]

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

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)))
const mix = (a, b, t) => a + (b - a) * t
const smoothstep = (edge0, edge1, value) => {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return x * x * (3 - 2 * x)
}

const distanceToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
  const x = ax + t * dx
  const y = ay + t * dy
  return Math.hypot(px - x, py - y)
}

const roundedRectAlpha = (x, y, size, inset, radius) => {
  const left = inset
  const top = inset
  const right = size - inset
  const bottom = size - inset
  const cx = Math.max(left + radius, Math.min(x, right - radius))
  const cy = Math.max(top + radius, Math.min(y, bottom - radius))
  const dist = Math.hypot(x - cx, y - cy) - radius
  return 1 - smoothstep(-1, 1.4, dist)
}

const iconPixel = (x, y, size) => {
  const bgAlpha = roundedRectAlpha(x, y, size, 0, size * 0.22)
  if (bgAlpha <= 0) return [0, 0, 0, 0]

  const gx = x / Math.max(1, size - 1)
  const gy = y / Math.max(1, size - 1)
  const bgT = Math.min(1, Math.max(0, (gx * 0.55 + gy * 0.75)))
  const c1 = [15, 23, 42]
  const c2 = [21, 94, 117]
  const c3 = [17, 24, 39]
  const bg = bgT < 0.5 ? c1.map((v, i) => mix(v, c2[i], bgT * 2)) : c2.map((v, i) => mix(v, c3[i], (bgT - 0.5) * 2))

  const borderAlpha = Math.max(
    0,
    roundedRectAlpha(x, y, size, size * 0.1, size * 0.16) - roundedRectAlpha(x, y, size, size * 0.13, size * 0.13)
  )
  let r = bg[0]
  let g = bg[1]
  let b = bg[2]
  if (borderAlpha > 0) {
    r = mix(r, 224, borderAlpha * 0.25)
    g = mix(g, 242, borderAlpha * 0.25)
    b = mix(b, 254, borderAlpha * 0.25)
  }

  const stroke = size * 0.07
  const d1 = distanceToSegment(x, y, size * 0.28, size * 0.34, size * 0.43, size * 0.5)
  const d2 = distanceToSegment(x, y, size * 0.43, size * 0.5, size * 0.28, size * 0.66)
  const promptAlpha = 1 - smoothstep(stroke * 0.7, stroke * 1.2, Math.min(d1, d2))
  if (promptAlpha > 0) {
    const t = (x + y) / (size * 2)
    const beam = t < 0.55 ? [125, 211, 252].map((v, i) => mix(v, [52, 211, 153][i], t / 0.55)) : [52, 211, 153].map((v, i) => mix(v, [250, 204, 21][i], (t - 0.55) / 0.45))
    r = mix(r, beam[0], promptAlpha)
    g = mix(g, beam[1], promptAlpha)
    b = mix(b, beam[2], promptAlpha)
  }

  const lineAlpha = 1 - smoothstep(stroke * 0.65, stroke * 1.05, distanceToSegment(x, y, size * 0.5, size * 0.66, size * 0.73, size * 0.66))
  if (lineAlpha > 0) {
    r = mix(r, 229, lineAlpha)
    g = mix(g, 231, lineAlpha)
    b = mix(b, 235, lineAlpha)
  }

  const orbitDistance = distanceToSegment(x, y, size * 0.49, size * 0.44, size * 0.63, size * 0.31)
  const orbitAlpha = Math.max(0, 1 - smoothstep(stroke * 0.28, stroke * 0.58, orbitDistance)) * smoothstep(size * 0.22, size * 0.45, x)
  if (orbitAlpha > 0) {
    r = mix(r, 125, orbitAlpha * 0.9)
    g = mix(g, 211, orbitAlpha * 0.9)
    b = mix(b, 252, orbitAlpha * 0.9)
  }

  const dot = Math.hypot(x - size * 0.72, y - size * 0.31)
  const dotAlpha = 1 - smoothstep(size * 0.04, size * 0.065, dot)
  if (dotAlpha > 0) {
    r = mix(r, 250, dotAlpha)
    g = mix(g, 204, dotAlpha)
    b = mix(b, 21, dotAlpha)
  }

  return [clamp(r), clamp(g), clamp(b), clamp(255 * bgAlpha)]
}

const png = (size) => {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let offset = 0
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0
    offset += 1
    for (let x = 0; x < size; x += 1) {
      const pixel = iconPixel(x + 0.5, y + 0.5, size)
      raw[offset] = pixel[0]
      raw[offset + 1] = pixel[1]
      raw[offset + 2] = pixel[2]
      raw[offset + 3] = pixel[3]
      offset += 4
    }
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
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

mkdirSync(outputDir, { recursive: true })
for (const size of sizes) {
  const file = resolve(outputDir, `${size}x${size}.png`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, png(size))
  console.log(`wrote ${file}`)
}
