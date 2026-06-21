import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { ControlResponse } from '@shared/contracts/control'

type ControlSocketCompatibilityRuntime = {
  userDataPath?: string
}

type CustomSidebarValidationEntry = {
  name: string
  path: string
  kind: 'swift' | 'json'
  ok: boolean
  error: string | null
}

let compatibilityRuntime: ControlSocketCompatibilityRuntime = {}

export const configureControlSocketCompatibilityRuntime = (runtime: ControlSocketCompatibilityRuntime = {}) => {
  compatibilityRuntime = { ...compatibilityRuntime, ...runtime }
}

export const isControlCloudVmMethod = (method: string) => method.startsWith('vm.')

export const isControlCloudRemotesMethod = (method: string) => method.startsWith('remotes.')

export const isControlSidebarCustomMethod = (method: string) => method.startsWith('sidebar.custom.')

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const cleanTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
  const text = cleanText(value)
  if (!text) return []
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const boolParam = (value: unknown) => {
  if (typeof value === 'boolean') return value
  const text = cleanText(value).toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(text)) return true
  if (['false', '0', 'no', 'off'].includes(text)) return false
  return undefined
}

const ok = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })

const fail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

const cloudUnsupportedData = (method: string, extra: Record<string, unknown> = {}) => ({
  ...extra,
  unsupported: true,
  unsupportedReason: 'aiopsterm does not implement control_compat Cloud VM or remote device registry services.',
  unsupported_reason: 'aiopsterm does not implement control_compat Cloud VM or remote device registry services.',
  method
})

export const authStatusPayload = () => ({
  signed_in: false,
  is_restoring_session: false,
  is_loading: false,
  timed_out: false,
  configured: false,
  local_control_socket: true,
  unsupported: true,
  unsupported_reason: 'aiopsterm does not use control_compat Stack Auth for the local control socket.'
})

export const unsupportedAuthStatusPayload = (action: 'begin_sign_in' | 'sign_out') => ({
  ...authStatusPayload(),
  action,
  completed: false,
  unsupported_reason:
    action === 'begin_sign_in'
      ? 'aiopsterm does not use control_compat Stack Auth for the local control socket.'
      : 'aiopsterm has no control_compat Stack Auth session to sign out from.'
})

export const feedbackSubmitPayload = (params: Record<string, unknown>) => {
  const email = cleanText(params.email)
  const body = cleanText(params.body || params.message || params.text)
  if (!email) return fail('INVALID_PARAMS', 'Missing email.', { field: 'email' })
  if (!body) return fail('INVALID_PARAMS', 'Missing body.', { field: 'body' })
  const imagePaths = Array.isArray(params.image_paths)
    ? params.image_paths.map(cleanText).filter(Boolean)
    : Array.isArray(params.imagePaths)
      ? params.imagePaths.map(cleanText).filter(Boolean)
      : []
  return ok({
    submitted: false,
    accepted: true,
    local_only: true,
    unsupported: true,
    unsupported_reason: 'aiopsterm accepted the feedback payload locally but has no configured feedback submission service.',
    email,
    body_length: body.length,
    attachment_count: imagePaths.length
  })
}

export const handleCloudVmControlRequest = (method: string, params: Record<string, unknown>) => {
  if (method === 'vm.list') {
    return ok(cloudUnsupportedData(method, { vms: [], count: 0 }))
  }
  if (method === 'vm.create') {
    const idempotencyKey = cleanText(params.idempotency_key || params.idempotencyKey)
    if (!idempotencyKey) return fail('INVALID_PARAMS', 'vm.create requires `idempotency_key`.', { field: 'idempotency_key' })
    return ok(
      cloudUnsupportedData(method, {
        created: false,
        provider: cleanText(params.provider),
        image: cleanText(params.image),
        idempotency_key: idempotencyKey
      })
    )
  }
  if (method === 'vm.destroy') {
    const id = cleanText(params.id || params.vmId || params.vm_id)
    if (!id) return fail('INVALID_PARAMS', 'vm.destroy requires `id`.', { field: 'id' })
    return ok(cloudUnsupportedData(method, { id, destroyed: false }))
  }
  if (method === 'vm.exec') {
    const id = cleanText(params.id || params.vmId || params.vm_id)
    if (!id) return fail('INVALID_PARAMS', 'vm.exec requires `id`.', { field: 'id' })
    const command = cleanText(params.command)
    if (!command) return fail('INVALID_PARAMS', 'vm.exec requires `command`.', { field: 'command' })
    return ok(cloudUnsupportedData(method, { id, command, exit_code: null, stdout: '', stderr: '', executed: false }))
  }
  if (method === 'vm.ssh_info' || method === 'vm.attach_info') {
    const id = cleanText(params.id || params.vmId || params.vm_id)
    if (!id) return fail('INVALID_PARAMS', `${method} requires \`id\`.`, { field: 'id' })
    return ok(
      cloudUnsupportedData(method, {
        id,
        host: null,
        port: null,
        token: null,
        attach_url: null,
        require_daemon: boolParam(params.require_daemon ?? params.requireDaemon) ?? false
      })
    )
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm Cloud VM compatibility method: ${method}`)
}

export const handleCloudRemotesControlRequest = (method: string, params: Record<string, unknown>) => {
  if (method === 'remotes.list') return ok(cloudUnsupportedData(method, { remotes: [], count: 0 }))
  if (method === 'remotes.add') {
    const name = cleanText(params.name)
    if (!name) return fail('INVALID_PARAMS', 'remotes.add requires `name`.', { field: 'name' })
    const routes = cleanTextList(params.routes)
    if (!routes.length) return fail('INVALID_PARAMS', 'remotes.add requires at least one route.', { field: 'routes' })
    return ok(cloudUnsupportedData(method, { ok: false, added: false, name, routes, tag: cleanText(params.tag) || null, deviceId: null }))
  }
  if (method === 'remotes.remove') {
    const target = cleanText(params.target || params.name || params.deviceId || params.device_id)
    if (!target) return fail('INVALID_PARAMS', 'remotes.remove requires `target`.', { field: 'target' })
    return ok(cloudUnsupportedData(method, { ok: false, removed: false, target, deviceId: null }))
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm remotes compatibility method: ${method}`)
}

const customSidebarDirectory = () => join(compatibilityRuntime.userDataPath || process.cwd(), 'custom-sidebars')

const customSidebarName = (params: Record<string, unknown>) => {
  if (!Object.prototype.hasOwnProperty.call(params, 'name')) return undefined
  return cleanText(params.name)
}

const customSidebarPathFor = (directory: string, name: string, kind: 'swift' | 'json') => join(directory, `${name}.${kind}`)

const discoverCustomSidebarFiles = async (directory: string, requestedName?: string) => {
  let names: string[] = []
  try {
    names = await readdir(directory)
  } catch {
    return []
  }
  const byName = new Map<string, { name: string; path: string; kind: 'swift' | 'json' }>()
  for (const entry of names) {
    const match = /^(.+)\.(swift|json)$/i.exec(entry)
    if (!match) continue
    const name = match[1]
    const kind = match[2].toLowerCase() as 'swift' | 'json'
    if (requestedName && requestedName !== name) continue
    const existing = byName.get(name)
    if (existing?.kind === 'swift') continue
    byName.set(name, { name, kind, path: join(directory, entry) })
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}

const validateCustomSidebarFile = async (file: { name: string; path: string; kind: 'swift' | 'json' }): Promise<CustomSidebarValidationEntry> => {
  if (file.kind === 'swift') {
    return {
      ...file,
      ok: false,
      error: 'aiopsterm does not execute or interpret control_compat custom Swift sidebars through the control socket.'
    }
  }
  try {
    JSON.parse(await readFile(file.path, 'utf-8'))
    return { ...file, ok: false, error: 'aiopsterm can parse this JSON file, but custom sidebar rendering is not implemented.' }
  } catch (error) {
    return { ...file, ok: false, error: error instanceof Error ? error.message : 'Failed to read sidebar JSON.' }
  }
}

const customSidebarReport = async (name?: string) => {
  const directory = customSidebarDirectory()
  const files = await discoverCustomSidebarFiles(directory, name)
  const entries =
    name && files.length === 0
      ? [
          {
            name,
            path: customSidebarPathFor(directory, name, 'json'),
            kind: 'json' as const,
            ok: false,
            error: 'Sidebar file is missing.'
          }
        ]
      : await Promise.all(files.map(validateCustomSidebarFile))
  return {
    directory,
    valid_count: entries.filter((entry) => entry.ok).length,
    error_count: entries.filter((entry) => !entry.ok).length,
    sidebars: entries,
    unsupported: true,
    unsupportedReason: 'aiopsterm does not implement control_compat custom sidebar rendering or selection.',
    unsupported_reason: 'aiopsterm does not implement control_compat custom sidebar rendering or selection.'
  }
}

export const handleSidebarCustomControlRequest = async (method: string, params: Record<string, unknown>) => {
  const name = customSidebarName(params)
  if ((method === 'sidebar.custom.validate' || method === 'sidebar.custom.reload') && name === '') {
    return fail('INVALID_PARAMS', 'Sidebar name must not be empty.')
  }
  if (method === 'sidebar.custom.validate') return ok(await customSidebarReport(name))
  if (method === 'sidebar.custom.reload') {
    const report = await customSidebarReport(name)
    return ok({
      ...report,
      reloaded_count: 0,
      reloaded_names: [],
      reloaded: false
    })
  }
  if (method === 'sidebar.custom.select') {
    if (!name) return fail('INVALID_PARAMS', 'Select requires a sidebar name.', { field: 'name' })
    const report = await customSidebarReport(name)
    return ok({
      ...report,
      selected_name: null,
      selected_provider_id: null,
      selected: false
    })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm custom sidebar compatibility method: ${method}`)
}
