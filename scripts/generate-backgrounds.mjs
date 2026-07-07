// 生成内置背景图预设:用 Chromium 渲染 SVG 艺术并导出 1920x1080 的 webp。
// 运行:node scripts/generate-backgrounds.mjs [--preview-dir <dir>]
// 输出:src/renderer/src/assets/backgrounds/<id>.webp
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 1920
const H = 1080
const scriptDir = dirname(fileURLToPath(import.meta.url))
const outputDir = resolve(scriptDir, '../src/renderer/src/assets/backgrounds')
const previewFlagIndex = process.argv.indexOf('--preview-dir')
const previewDir = previewFlagIndex >= 0 ? resolve(process.argv[previewFlagIndex + 1]) : null

// 确定性随机,保证同一版本脚本产出逐字节稳定的构图
const mulberry32 = (seed) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const grain = (opacity, seed = 7) => `
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="${opacity}" style="mix-blend-mode: overlay"/>`

const vignette = (strength = 0.32) => `
  <radialGradient id="vig" cx="50%" cy="46%" r="72%">
    <stop offset="62%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000" stop-opacity="${strength}"/>
  </radialGradient>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>`

const svgDoc = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`

// 平滑贝塞尔山脊/波峰路径:points 为 [x, y] 折点,用 Catmull-Rom 转三次贝塞尔
const ridgePath = (points, closeToBottom = true) => {
  const pts = points
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  if (closeToBottom) d += ` L ${W} ${H} L 0 ${H} Z`
  return d
}

const ridgePoints = (rand, baseY, amplitude, segments = 7) => {
  const pts = []
  for (let i = 0; i <= segments; i++) {
    pts.push([(W / segments) * i, baseY + (rand() - 0.5) * 2 * amplitude])
  }
  return pts
}

const artworks = {
  // 深邃靛蓝夜空 + 青绿/紫极光帘幕。适配 Nord/Catppuccin/Dracula/Dark。
  'aurora-veil': () => {
    const rand = mulberry32(42)
    let stars = ''
    for (let i = 0; i < 160; i++) {
      const x = rand() * W
      const y = rand() * H * 0.72
      const r = rand() < 0.85 ? 0.9 : 1.7
      stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#dce8f4" opacity="${(0.16 + rand() * 0.4).toFixed(2)}"/>`
    }
    return svgDoc(`
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stop-color="#0a0f22"/><stop offset="55%" stop-color="#101731"/><stop offset="100%" stop-color="#070b16"/>
        </linearGradient>
        <linearGradient id="rib1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#2ee6a8" stop-opacity="0"/><stop offset="45%" stop-color="#2ee6a8" stop-opacity="0.5"/><stop offset="100%" stop-color="#37c8f0" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="rib2" x1="0" y1="0" x2="1" y2="0.8">
          <stop offset="0%" stop-color="#7c5cff" stop-opacity="0"/><stop offset="50%" stop-color="#7c5cff" stop-opacity="0.38"/><stop offset="100%" stop-color="#b48ead" stop-opacity="0"/>
        </linearGradient>
        <filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="46"/></filter>
        <filter id="softer" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="70"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#sky)"/>
      ${stars}
      <g style="mix-blend-mode: screen">
        <path d="M -80 720 C 320 520, 560 700, 920 430 C 1180 240, 1480 350, 2000 130 L 2000 320 C 1500 520, 1180 430, 940 620 C 660 830, 300 700, -80 860 Z" fill="url(#rib1)" filter="url(#soft)"/>
        <path d="M -80 500 C 420 380, 760 520, 1120 300 C 1400 140, 1680 220, 2000 60 L 2000 200 C 1700 340, 1420 300, 1160 460 C 840 660, 420 520, -80 640 Z" fill="url(#rib2)" filter="url(#softer)"/>
        <ellipse cx="1560" cy="880" rx="560" ry="260" fill="#16324a" opacity="0.55" filter="url(#softer)"/>
      </g>
      ${vignette(0.34)}
      ${grain(0.05, 11)}`)
  },

  // 近纯黑星尘 + 微弱星云。适配 Obsidian Black/Dark/Flexoki Dark。
  'nebula-dust': () => {
    const rand = mulberry32(7)
    let stars = ''
    for (let i = 0; i < 340; i++) {
      const x = rand() * W
      const y = rand() * H
      const tier = rand()
      const r = tier < 0.78 ? 0.8 : tier < 0.95 ? 1.4 : 2.2
      const tone = rand() < 0.72 ? '#d9e2ec' : rand() < 0.5 ? '#9fd4e8' : '#e8d4c8'
      stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${tone}" opacity="${(0.12 + rand() * 0.42).toFixed(2)}"/>`
    }
    let glows = ''
    for (let i = 0; i < 9; i++) {
      const x = rand() * W
      const y = rand() * H
      glows += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="#f2f6fa" opacity="0.85"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="#cfe6f2" opacity="0.2" filter="url(#tiny)"/>`
    }
    return svgDoc(`
      <defs>
        <radialGradient id="deep" cx="34%" cy="30%" r="120%">
          <stop offset="0%" stop-color="#0a0c14"/><stop offset="100%" stop-color="#04050a"/>
        </radialGradient>
        <filter id="wisp" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="90"/></filter>
        <filter id="tiny"><feGaussianBlur stdDeviation="2.4"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#deep)"/>
      <g style="mix-blend-mode: screen">
        <ellipse cx="470" cy="330" rx="520" ry="300" fill="#123240" opacity="0.5" filter="url(#wisp)"/>
        <ellipse cx="1490" cy="760" rx="580" ry="320" fill="#2a1638" opacity="0.5" filter="url(#wisp)"/>
        <ellipse cx="1250" cy="240" rx="360" ry="200" fill="#101c3a" opacity="0.55" filter="url(#wisp)"/>
      </g>
      ${stars}
      ${glows}
      ${vignette(0.3)}
      ${grain(0.045, 23)}`)
  },

  // 赛博地平线:霓虹透视网格 + 青品双色辉光。适配 Obsidian Black/Hacker 系。
  'neon-horizon': () => {
    const horizon = H * 0.6
    const vpx = W * 0.5
    let verticals = ''
    for (let i = -14; i <= 14; i++) {
      const spread = i * 190
      verticals += `<line x1="${vpx}" y1="${horizon}" x2="${vpx + spread}" y2="${H + 60}" stroke="url(#gridv)" stroke-width="2"/>`
    }
    let horizontals = ''
    for (let i = 1; i <= 11; i++) {
      const t = i / 11
      const y = horizon + Math.pow(t, 2.1) * (H - horizon)
      horizontals += `<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke="#22d3ee" stroke-opacity="${(0.1 + t * 0.34).toFixed(2)}" stroke-width="${(1 + t * 1.6).toFixed(1)}"/>`
    }
    return svgDoc(`
      <defs>
        <linearGradient id="nsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#04040a"/><stop offset="70%" stop-color="#0a0918"/><stop offset="100%" stop-color="#120a20"/>
        </linearGradient>
        <linearGradient id="gridv" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.05"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0.34"/>
        </linearGradient>
        <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0c1024"/><stop offset="100%" stop-color="#05060d"/>
        </linearGradient>
        <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="60"/></filter>
        <filter id="lineglow"><feGaussianBlur stdDeviation="6"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#nsky)"/>
      <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#floor)"/>
      <g style="mix-blend-mode: screen">
        <ellipse cx="${vpx}" cy="${horizon}" rx="820" ry="230" fill="#c026d3" opacity="0.2" filter="url(#glow)"/>
        <ellipse cx="${vpx}" cy="${horizon}" rx="430" ry="110" fill="#22d3ee" opacity="0.22" filter="url(#glow)"/>
      </g>
      ${verticals}
      ${horizontals}
      <line x1="0" y1="${horizon}" x2="${W}" y2="${horizon}" stroke="#67e8f9" stroke-opacity="0.5" stroke-width="2.4" filter="url(#lineglow)"/>
      <line x1="0" y1="${horizon}" x2="${W}" y2="${horizon}" stroke="#e0faff" stroke-opacity="0.6" stroke-width="1"/>
      ${vignette(0.38)}
      ${grain(0.04, 5)}`)
  },

  // 神奈川潮:靛蓝层浪 + 米色浪尖。适配 Kanagawa 系。
  'kanagawa-tide': () => {
    const rand = mulberry32(1831)
    const bands = [
      { y: H * 0.5, amp: 66, fill: '#2f3048', crest: '#54547a' },
      { y: H * 0.62, amp: 74, fill: '#3a3b58', crest: '#6a6b96' },
      { y: H * 0.74, amp: 80, fill: '#454670', crest: '#7e9cd8' },
      { y: H * 0.86, amp: 66, fill: '#363656', crest: '#957fb8' }
    ]
    let waves = ''
    for (const band of bands) {
      const pts = ridgePoints(rand, band.y, band.amp, 8)
      const d = ridgePath(pts)
      waves += `<path d="${d}" fill="${band.fill}"/><path d="${ridgePath(pts, false)}" fill="none" stroke="${band.crest}" stroke-opacity="0.6" stroke-width="3.4"/>`
      let foam = ''
      for (let i = 0; i < 12; i++) {
        const x = rand() * W
        const py = pts.reduce((acc, p, idx) => (Math.abs(p[0] - x) < Math.abs(pts[acc][0] - x) ? idx : acc), 0)
        foam += `<circle cx="${x.toFixed(1)}" cy="${(pts[py][1] + 6 + rand() * 10).toFixed(1)}" r="${(2 + rand() * 3.4).toFixed(1)}" fill="#dcd7ba" opacity="${(0.18 + rand() * 0.3).toFixed(2)}"/>`
      }
      waves += foam
    }
    return svgDoc(`
      <defs>
        <linearGradient id="ksky" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stop-color="#181826"/><stop offset="100%" stop-color="#222336"/>
        </linearGradient>
        <filter id="moon" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="34"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#ksky)"/>
      <circle cx="1520" cy="230" r="86" fill="#dcd7ba" opacity="0.6"/>
      <circle cx="1520" cy="230" r="130" fill="#e6c384" opacity="0.16" filter="url(#moon)"/>
      ${waves}
      ${vignette(0.3)}
      ${grain(0.045, 31)}`)
  },

  // 茄紫沙丘 + Ubuntu 橙轮廓光。适配 Ubuntu 系。
  'aubergine-dune': () => {
    const rand = mulberry32(2204)
    const duneA = ridgePoints(rand, H * 0.58, 90, 6)
    const duneB = ridgePoints(rand, H * 0.72, 70, 7)
    const duneC = ridgePoints(rand, H * 0.86, 50, 6)
    return svgDoc(`
      <defs>
        <linearGradient id="usky" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0%" stop-color="#3c0d2e"/><stop offset="60%" stop-color="#571e42"/><stop offset="100%" stop-color="#2a081f"/>
        </linearGradient>
        <filter id="sun" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="80"/></filter>
        <filter id="rim"><feGaussianBlur stdDeviation="9"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#usky)"/>
      <circle cx="1420" cy="${H * 0.5}" r="300" fill="#e95420" opacity="0.3" filter="url(#sun)"/>
      <circle cx="1420" cy="${H * 0.5}" r="110" fill="#f6b380" opacity="0.5" filter="url(#sun)"/>
      <path d="${ridgePath(duneA, false)}" fill="none" stroke="#f08c50" stroke-opacity="0.75" stroke-width="5" filter="url(#rim)"/>
      <path d="${ridgePath(duneA)}" fill="#43102f"/>
      <path d="${ridgePath(duneB, false)}" fill="none" stroke="#d1699b" stroke-opacity="0.3" stroke-width="4" filter="url(#rim)"/>
      <path d="${ridgePath(duneB)}" fill="#340b26"/>
      <path d="${ridgePath(duneC)}" fill="#25071c"/>
      ${vignette(0.3)}
      ${grain(0.05, 17)}`)
  },

  // 石墨斜纹织物 + 青绿信号光。适配 Dark/Gruvbox Dark/Termius Dark。
  'carbon-weave': () => {
    return svgDoc(`
      <defs>
        <linearGradient id="cbase" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stop-color="#14161b"/><stop offset="52%" stop-color="#1b1e25"/><stop offset="100%" stop-color="#101217"/>
        </linearGradient>
        <pattern id="weave" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="14" height="14" fill="none"/>
          <line x1="0" y1="0" x2="0" y2="14" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1.4"/>
          <line x1="7" y1="0" x2="7" y2="14" stroke="#000000" stroke-opacity="0.22" stroke-width="1.6"/>
        </pattern>
        <filter id="sig" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="110"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#cbase)"/>
      <rect width="${W}" height="${H}" fill="url(#weave)"/>
      <g style="mix-blend-mode: screen">
        <ellipse cx="330" cy="850" rx="520" ry="330" fill="#1f4d43" opacity="0.5" filter="url(#sig)"/>
        <ellipse cx="1650" cy="210" rx="480" ry="300" fill="#173a4d" opacity="0.5" filter="url(#sig)"/>
      </g>
      ${vignette(0.32)}
      ${grain(0.04, 3)}`)
  },

  // 暖纸雾:奶油纸底 + 暖雾。适配 Solarized/Gruvbox Light/Flexoki Light。
  'paper-fog': () => {
    return svgDoc(`
      <defs>
        <linearGradient id="paper" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stop-color="#f7f1de"/><stop offset="100%" stop-color="#eadfc4"/>
        </linearGradient>
        <filter id="mist" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="120"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#paper)"/>
      <ellipse cx="380" cy="260" rx="640" ry="360" fill="#fdf8ea" opacity="0.85" filter="url(#mist)"/>
      <ellipse cx="1580" cy="820" rx="700" ry="380" fill="#ddceab" opacity="0.6" filter="url(#mist)"/>
      <ellipse cx="1440" cy="240" rx="440" ry="260" fill="#e9d9b8" opacity="0.5" filter="url(#mist)"/>
      <ellipse cx="700" cy="900" rx="560" ry="300" fill="#f4ecd6" opacity="0.7" filter="url(#mist)"/>
      ${grain(0.05, 13)}`)
  },

  // 瓷釉天空:冷调云层与光带。适配 Light/One Light/Nord Snow Storm/Ayu Light。
  'porcelain-sky': () => {
    return svgDoc(`
      <defs>
        <linearGradient id="psky" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stop-color="#f2f6fb"/><stop offset="100%" stop-color="#dde6f1"/>
        </linearGradient>
        <filter id="cloud" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="110"/></filter>
        <linearGradient id="shaft" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/><stop offset="50%" stop-color="#ffffff" stop-opacity="0.5"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#psky)"/>
      <ellipse cx="420" cy="300" rx="620" ry="330" fill="#ffffff" opacity="0.8" filter="url(#cloud)"/>
      <ellipse cx="1520" cy="740" rx="680" ry="360" fill="#c6d6ea" opacity="0.6" filter="url(#cloud)"/>
      <ellipse cx="1360" cy="220" rx="420" ry="240" fill="#dbe7f4" opacity="0.7" filter="url(#cloud)"/>
      <rect x="500" y="-200" width="360" height="1600" fill="url(#shaft)" transform="rotate(24 900 540)" opacity="0.5"/>
      ${grain(0.04, 29)}`)
  },

  // 晨曦玫瑰:金色地平光 + 粉紫渐层。适配 Rose Pine Dawn/Catppuccin Latte。
  'rose-dawn': () => {
    return svgDoc(`
      <defs>
        <linearGradient id="dawn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#d9d3ea"/><stop offset="42%" stop-color="#ecd5d8"/><stop offset="78%" stop-color="#f7e3cf"/><stop offset="100%" stop-color="#fbeed9"/>
        </linearGradient>
        <filter id="halo" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="90"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#dawn)"/>
      <circle cx="1250" cy="${H * 0.78}" r="300" fill="#f5c163" opacity="0.5" filter="url(#halo)"/>
      <circle cx="1250" cy="${H * 0.78}" r="110" fill="#fce3ae" opacity="0.8" filter="url(#halo)"/>
      <ellipse cx="360" cy="220" rx="520" ry="280" fill="#c9bfe4" opacity="0.55" filter="url(#halo)"/>
      <ellipse cx="1700" cy="320" rx="420" ry="240" fill="#e8b7bd" opacity="0.5" filter="url(#halo)"/>
      <ellipse cx="620" cy="900" rx="620" ry="260" fill="#f2cdb4" opacity="0.5" filter="url(#halo)"/>
      ${grain(0.045, 19)}`)
  },

  // 樱花飘落:粉白天空 + 柔焦花影与飘散花瓣。适配 Sakura Blossom/Rose Milk/Neon Pink。
  'sakura-drift': () => {
    const rand = mulberry32(520)
    let petals = ''
    for (let i = 0; i < 46; i++) {
      const x = rand() * W
      const y = rand() * H
      const size = 5 + rand() * 9
      const angle = rand() * 360
      const tone = rand() < 0.6 ? '#eba3bd' : rand() < 0.5 ? '#f3bfd2' : '#df8fae'
      petals += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${size.toFixed(1)}" ry="${(size * 0.55).toFixed(1)}" fill="${tone}" opacity="${(0.28 + rand() * 0.42).toFixed(2)}" transform="rotate(${angle.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`
    }
    let bokeh = ''
    for (let i = 0; i < 10; i++) {
      const x = rand() * W
      const y = rand() * H
      bokeh += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(26 + rand() * 44).toFixed(1)}" fill="#f5c8d8" opacity="${(0.1 + rand() * 0.16).toFixed(2)}" filter="url(#bokeh)"/>`
    }
    return svgDoc(`
      <defs>
        <linearGradient id="ssky" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stop-color="#fdf3f6"/><stop offset="55%" stop-color="#f9e4ec"/><stop offset="100%" stop-color="#f3d5e0"/>
        </linearGradient>
        <filter id="bloom" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="100"/></filter>
        <filter id="bokeh" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#ssky)"/>
      <ellipse cx="360" cy="240" rx="560" ry="330" fill="#fefaf9" opacity="0.85" filter="url(#bloom)"/>
      <ellipse cx="1600" cy="300" rx="480" ry="300" fill="#f2b9cd" opacity="0.5" filter="url(#bloom)"/>
      <ellipse cx="1250" cy="880" rx="640" ry="320" fill="#eeaec6" opacity="0.4" filter="url(#bloom)"/>
      ${bokeh}
      ${petals}
      ${grain(0.04, 41)}`)
  },

  // 黛山雾:水墨青山层峦。适配浅色系与 Kanagawa Lotus。
  'jade-mist': () => {
    const rand = mulberry32(908)
    const layers = [
      { y: H * 0.52, amp: 110, fill: '#a9c3b8', opacity: 0.75 },
      { y: H * 0.64, amp: 96, fill: '#8fae9f', opacity: 0.82 },
      { y: H * 0.78, amp: 80, fill: '#6f9284', opacity: 0.9 },
      { y: H * 0.9, amp: 54, fill: '#587c6f', opacity: 1 }
    ]
    let hills = ''
    for (const layer of layers) {
      hills += `<path d="${ridgePath(ridgePoints(rand, layer.y, layer.amp, 6))}" fill="${layer.fill}" opacity="${layer.opacity}"/>`
      hills += `<rect y="${layer.y + 30}" width="${W}" height="120" fill="#eef4ef" opacity="0.3" filter="url(#mistband)"/>`
    }
    return svgDoc(`
      <defs>
        <linearGradient id="jsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f0f5f0"/><stop offset="100%" stop-color="#dce8e0"/>
        </linearGradient>
        <filter id="mistband" x="-20%" y="-120%" width="140%" height="340%"><feGaussianBlur stdDeviation="46"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#jsky)"/>
      <circle cx="1490" cy="240" r="70" fill="#f6ede0" opacity="0.9"/>
      ${hills}
      ${grain(0.045, 37)}`)
  }
}

const run = async () => {
  mkdirSync(outputDir, { recursive: true })
  if (previewDir) mkdirSync(previewDir, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  for (const [id, build] of Object.entries(artworks)) {
    const svg = svgDoc ? build() : ''
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const result = await page.evaluate(
      async ({ src, width, height }) => {
        const image = new Image()
        image.decoding = 'sync'
        await new Promise((resolveLoad, rejectLoad) => {
          image.onload = resolveLoad
          image.onerror = () => rejectLoad(new Error('svg decode failed'))
          image.src = src
        })
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0, width, height)
        return {
          webp: canvas.toDataURL('image/webp', 0.9),
          png: canvas.toDataURL('image/png')
        }
      },
      { src: dataUrl, width: W, height: H }
    )
    const webpBytes = Buffer.from(result.webp.split(',')[1], 'base64')
    writeFileSync(resolve(outputDir, `${id}.webp`), webpBytes)
    if (previewDir) writeFileSync(resolve(previewDir, `${id}.png`), Buffer.from(result.png.split(',')[1], 'base64'))
    console.log(`${id}.webp ${(webpBytes.length / 1024).toFixed(1)}KB`)
  }
  await browser.close()
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
