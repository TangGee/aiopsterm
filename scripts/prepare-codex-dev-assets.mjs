#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { codexDevTargetTriple } from './codex-runtime-paths.mjs'

const target = process.env.AIOPSTERM_CODEX_DEV_TARGET || codexDevTargetTriple()
const version = readV8Version()
const cacheDir = join(tmpdir(), 'codex-package', `rusty-v8-${version}-${target}`)
const baseUrl = `https://github.com/openai/codex/releases/download/rusty-v8-v${version}`
const checksumName = `rusty_v8_release_${target}.sha256`
const archiveName = `librusty_v8_release_${target}.a.gz`
const bindingName = `src_binding_release_${target}.rs`

mkdirSync(cacheDir, { recursive: true })

const mirrors = mirrorPrefixes()
const checksumsPath = join(cacheDir, checksumName)
await ensureDownloaded(`${baseUrl}/${checksumName}`, checksumsPath, mirrors)

const checksums = parseChecksums(readFileSync(checksumsPath, 'utf8'))
for (const name of [archiveName, bindingName]) {
  const file = join(cacheDir, name)
  if (!hasChecksum(file, checksums.get(name))) {
    await ensureDownloaded(`${baseUrl}/${name}`, file, mirrors)
  }
  if (!hasChecksum(file, checksums.get(name))) {
    throw new Error(`Codex V8 artifact checksum mismatch after download: ${file}`)
  }
}

console.log(`RUSTY_V8_ARCHIVE=${join(cacheDir, archiveName)}`)
console.log(`RUSTY_V8_SRC_BINDING_PATH=${join(cacheDir, bindingName)}`)

function readV8Version() {
  const lock = readFileSync('codex/codex-rs/Cargo.lock', 'utf8')
  const match = lock.match(/\[\[package\]\]\s+name = "v8"\s+version = "([^"]+)"/m)
  if (!match) throw new Error('Unable to determine v8 crate version from codex/codex-rs/Cargo.lock')
  return match[1]
}

function mirrorPrefixes() {
  const configured = String(process.env.AIOPSTERM_GITHUB_MIRROR || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return [
    ...configured,
    'https://gh.llkk.cc/',
    'https://gh-proxy.com/',
    'https://ghproxy.net/',
    ''
  ]
}

function mirrorUrl(url, prefix) {
  if (!prefix) return url
  if (prefix.includes('{url}')) return prefix.replaceAll('{url}', encodeURIComponent(url))
  return `${prefix.replace(/\/?$/, '/')}${url}`
}

function parseChecksums(text) {
  const entries = new Map()
  for (const line of text.trim().split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{64})\s+(.+)$/)
    if (!match) throw new Error(`Invalid V8 checksum line: ${line}`)
    entries.set(match[2].trim(), match[1])
  }
  for (const name of [archiveName, bindingName]) {
    if (!entries.has(name)) throw new Error(`V8 checksum manifest is missing ${name}`)
  }
  return entries
}

function hasChecksum(file, expected) {
  if (!expected || !existsSync(file) || !statSync(file).isFile()) return false
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex')
  return digest === expected
}

async function ensureDownloaded(url, dest, mirrors) {
  if (existsSync(dest) && statSync(dest).isFile() && statSync(dest).size > 0) return
  const errors = []
  for (const prefix of mirrors) {
    const candidate = mirrorUrl(url, prefix)
    try {
      await download(candidate, dest)
      console.error(`[aiopsterm] downloaded ${basename(dest)} from ${prefix || 'github.com'}`)
      return
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
      await delay(250)
    }
  }
  throw new Error(`Unable to download ${url}\n${errors.join('\n')}`)
}

async function download(url, dest) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.AIOPSTERM_CODEX_DOWNLOAD_TIMEOUT_MS || 180000))
  const temp = `${dest}.tmp`
  rmSync(temp, { force: true })
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    await pipeline(response.body, createWriteStream(temp))
    renameSync(temp, dest)
  } finally {
    clearTimeout(timeout)
    rmSync(temp, { force: true })
  }
}
