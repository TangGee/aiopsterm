import { createHash } from 'crypto'
import type { TransferEndpoint, TransferStat } from './filesTransferEndpoint'

export type TransferManifestEntry = {
  source: string
  target: string
  stat: TransferStat
  temporary: string
  original?: TransferStat | null
  digest?: string
  link?: string
  done?: boolean
}
export type CopyControl = {
  check: () => void
  save: () => void
  progress: (bytes: number, verifying: boolean) => void
}
const failure = (code: string, message: string) => Object.assign(new Error(message), { code })
export const sameTransferStat = (a: TransferStat | null, b: TransferStat | null) =>
  a === null || b === null ? a === b : a.kind === b.kind && a.size === b.size && a.mtime === b.mtime

export const transferDigest = async (endpoint: TransferEndpoint, path: string, control: CopyControl, length = Infinity) => {
  const handle = await endpoint.open(path, 'r')
  const hash = createHash('sha256')
  let position = 0
  try {
    while (position < length) {
      control.check()
      const buffer = Buffer.alloc(Math.min(256 * 1024, length - position))
      const count = await handle.read(buffer, position)
      if (!count) break
      hash.update(buffer.subarray(0, count))
      position += count
    }
  } finally { await handle.close() }
  if (Number.isFinite(length) && position !== length) throw failure('source_changed', '文件长度发生变化，请重新创建传输任务')
  return hash.digest('hex')
}

export const copyResumableEntry = async (
  source: TransferEndpoint, target: TransferEndpoint, entry: TransferManifestEntry,
  overwrite: boolean, control: CopyControl
) => {
  control.check()
  if (!sameTransferStat(await source.stat(entry.source), entry.stat)) throw failure('source_changed', '源文件已改变，请重新创建传输任务')
  const existing = await target.stat(entry.target)
  if (entry.stat.kind === 'directory') {
    await target.mkdir(entry.target)
    entry.done = true
    control.save()
    return
  }
  if (entry.done) {
    if (!existing || existing.kind !== entry.stat.kind) throw failure('target_changed', '已完成的目标文件已改变，请重新创建传输任务')
    if (entry.stat.kind === 'file') {
      if (await transferDigest(source, entry.source, control) !== entry.digest) throw failure('source_changed', '源文件已改变，请重新创建传输任务')
      if (await transferDigest(target, entry.target, control) !== entry.digest) throw failure('target_changed', '已完成的目标文件已改变，请重新创建传输任务')
    } else if (await target.readlink(entry.target) !== entry.link || await source.readlink(entry.source) !== entry.link) {
      throw failure('source_changed', '符号链接已改变，请重新创建传输任务')
    }
    return
  }
  // Recover a rename committed immediately before a process interruption.
  if (entry.digest && existing?.kind === 'file' && !(await target.stat(entry.temporary)) && await transferDigest(target, entry.target, control) === entry.digest) {
    if (await transferDigest(source, entry.source, control) !== entry.digest) throw failure('source_changed', '源文件已改变，请重新创建传输任务')
    entry.done = true
    control.save()
    return
  }
  if (entry.link !== undefined && existing?.kind === 'link' && !(await target.stat(entry.temporary)) && await target.readlink(entry.target) === entry.link) {
    if (await source.readlink(entry.source) !== entry.link) throw failure('source_changed', '符号链接已改变')
    entry.done = true
    control.save()
    return
  }
  if (entry.original === undefined) {
    if (existing && !overwrite) throw failure('target_exists', '目标已存在，未覆盖原文件')
    if (existing && existing.kind !== entry.stat.kind) throw failure('target_type', '目标类型不同，未覆盖原文件')
    entry.original = existing
    control.save()
  } else if (!sameTransferStat(existing, entry.original)) {
    throw failure('target_changed', '目标文件在传输期间已改变，未覆盖原文件')
  }
  await target.mkdir(target.parent(entry.target))
  if (entry.stat.kind === 'link') {
    const link = await source.readlink(entry.source)
    if (entry.link !== undefined && entry.link !== link) throw failure('source_changed', '符号链接已改变')
    entry.link = link
    control.save()
    const partial = await target.stat(entry.temporary)
    if (partial) {
      if (partial.kind !== 'link' || await target.readlink(entry.temporary) !== link) throw failure('partial_changed', '临时文件已改变')
    } else await target.symlink(link, entry.temporary)
  } else {
    control.progress(0, true)
    const digest = await transferDigest(source, entry.source, control)
    if (entry.digest && entry.digest !== digest) throw failure('source_changed', '源文件内容已改变，请重新创建传输任务')
    entry.digest = digest
    control.save()
    const partial = await target.stat(entry.temporary)
    if (partial && (partial.kind !== 'file' || partial.size > entry.stat.size)) throw failure('partial_changed', '临时文件类型或大小不匹配，不能续传')
    let position = partial?.size || 0
    if (position) {
      const expected = await transferDigest(source, entry.source, control, position)
      if (await transferDigest(target, entry.temporary, control, position) !== expected) throw failure('partial_changed', '已传内容校验失败，不能续传')
    }
    control.progress(position, false)
    const reader = await source.open(entry.source, 'r')
    try {
      const writer = await target.open(entry.temporary, partial ? 'r+' : 'wx')
      try {
        const buffer = Buffer.alloc(256 * 1024)
        while (position < entry.stat.size) {
          control.check()
          const count = await reader.read(buffer.subarray(0, Math.min(buffer.length, entry.stat.size - position)), position)
          if (!count) throw failure('source_changed', '源文件在传输期间被截断')
          await writer.write(buffer.subarray(0, count), position)
          position += count
          control.progress(position, false)
        }
      } finally { await writer.close() }
    } finally { await reader.close() }
    control.check()
    control.progress(position, true)
    if (!sameTransferStat(await source.stat(entry.source), entry.stat) || await transferDigest(target, entry.temporary, control) !== entry.digest) {
      throw failure('checksum_failed', '传输内容校验失败，未替换目标文件')
    }
  }
  control.check()
  if (!sameTransferStat(await target.stat(entry.target), entry.original ?? null)) throw failure('target_changed', '目标文件在传输期间已改变，未覆盖原文件')
  const mode = entry.original?.mode ?? entry.stat.mode
  if (entry.stat.kind === 'file' && mode !== undefined) await target.chmod(entry.temporary, mode & 0o777)
  await target.rename(entry.temporary, entry.target)
  entry.done = true
  control.save()
}
