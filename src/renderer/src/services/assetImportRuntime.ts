import type { AiopsAssetAuthType, AiopsAssetType } from '@shared/preload'

export type ImportedAssetDraft = {
  title: string
  host: string
  username: string
  group: string
  port: number
  auth_type: AiopsAssetAuthType
  asset_type: AiopsAssetType
  comment: string
  password?: string
  proxyName?: string
  needProxy?: boolean
}

type ParsedSession = {
  name: string
  host: string
  port?: number
  username?: string
  password?: string
  authType?: AiopsAssetAuthType
  keyFile?: string
  protocol?: string
  groupName?: string
  proxyHost?: string
  proxyPort?: number
  proxyUser?: string
  comment?: string
}

const defaultGroup = 'Imported'

const decodeTextEntities = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

const cleanValue = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/^"|"$/g, '')
    .trim()

const normalizePort = (value: unknown, fallback = 22) => {
  const raw = cleanValue(value)
  if (!raw) return fallback
  if (raw.length > 5 && raw.startsWith('00')) return Number.parseInt(raw, 16) || fallback
  return Number.parseInt(raw, 10) || fallback
}

const isPrivateKeyHint = (value: string) => /\.(?:pem|ppk|key)$/i.test(value) || /(?:id_rsa|id_ed25519|privatekey)/i.test(value)

const normalizeAuthType = (raw: unknown, keyFile?: string): AiopsAssetAuthType => {
  if (keyFile) return 'keyBased'
  const value = cleanValue(raw).toLowerCase()
  if (value.includes('public') || value.includes('key') || value === 'keybased') return 'keyBased'
  return 'password'
}

const normalizeDraft = (raw: Partial<ImportedAssetDraft> & Record<string, unknown>, index: number): ImportedAssetDraft | null => {
  const host = cleanValue(raw.host || raw.ip || raw.address || raw.hostname)
  const username = cleanValue(raw.username || raw.user || raw.user_name || 'root')
  if (!host || !username) return null
  const port = normalizePort(raw.port)
  const keyFile = cleanValue(raw.keyFile || raw.key_file || raw.privateKeyFile || raw.private_key_file)
  const title = cleanValue(raw.title || raw.label || raw.name || `${host}:${port}`) || `Imported ${index + 1}`
  const group = cleanValue(raw.group || raw.group_name || raw.groupName || defaultGroup) || defaultGroup
  const proxyName = cleanValue(raw.proxyName || raw.proxy_name)
  const proxyHost = cleanValue(raw.proxyHost || raw.proxy_host)
  const proxyPort = normalizePort(raw.proxyPort || raw.proxy_port, 22)
  return {
    title,
    host,
    username,
    group,
    port,
    auth_type: normalizeAuthType(raw.auth_type || raw.authType, keyFile),
    asset_type: raw.asset_type === 'organization' || raw.asset_type === 'switch' ? raw.asset_type : 'person',
    comment: cleanValue(raw.comment || raw.description || keyFile || raw.protocol || ''),
    password: cleanValue(raw.password),
    proxyName: proxyName || (proxyHost ? `${proxyHost}:${proxyPort}` : ''),
    needProxy: Boolean(raw.needProxy || proxyName || proxyHost)
  }
}

const sessionToDraft = (session: ParsedSession, index: number) =>
  normalizeDraft(
    {
      title: session.name || session.host,
      host: session.host,
      username: session.username || 'root',
      group: session.groupName || defaultGroup,
      port: session.port || 22,
      authType: session.authType || (session.keyFile ? 'keyBased' : 'password'),
      password: session.password,
      comment: session.comment || session.keyFile || session.protocol || '',
      proxyHost: session.proxyHost,
      proxyPort: session.proxyPort,
      proxyName: session.proxyHost ? `${session.proxyHost}:${session.proxyPort || 22}` : ''
    },
    index
  )

const parseDelimitedLine = (line: string, index: number): ImportedAssetDraft | null => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const parts = trimmed.split(/[,;\t]/).map(cleanValue)
  const hasDelimitedFields = parts.length >= 2
  const sshMatch = trimmed.match(/(?:ssh\s+)?(?:(?<user>[^@\s,;]+)@)?(?<host>[a-zA-Z0-9_.:-]+)(?::(?<port>\d+))?/)
  const [titlePart, hostPart, userPart, groupPart, portPart] = parts
  const matchedHost = sshMatch?.groups?.host?.replace(/:(\d+)$/, '')
  const matchedPort = sshMatch?.groups?.port || sshMatch?.groups?.host?.match(/:(\d+)$/)?.[1]
  return normalizeDraft(
    {
      title: hasDelimitedFields ? titlePart || hostPart : titlePart || matchedHost,
      host: hasDelimitedFields ? hostPart || matchedHost : matchedHost || titlePart,
      username: userPart || sshMatch?.groups?.user || 'root',
      group: groupPart || defaultGroup,
      port: normalizePort(portPart || matchedPort || 22)
    },
    index
  )
}

const parseGenericKeyValueBlock = (block: string, fallbackName: string, index: number): ImportedAssetDraft | null => {
  const raw: Record<string, unknown> = { title: fallbackName }
  for (const line of block.split(/\r?\n/)) {
    const equalIndex = line.indexOf('=')
    if (equalIndex < 0) continue
    const key = line
      .slice(0, equalIndex)
      .trim()
      .replace(/^[SD]:/, '')
      .replace(/"/g, '')
      .toLowerCase()
    const value = cleanValue(line.slice(equalIndex + 1))
    if (!value) continue
    if (['host', 'hostname', 'ip', 'address', 'serverhost'].includes(key)) raw.host = value
    else if (['username', 'user', 'user_name'].includes(key)) raw.username = value
    else if (['port', 'portnum'].includes(key)) raw.port = value
    else if (['description', 'name', 'label', 'sessionname'].includes(key)) raw.title = value
    else if (['group', 'group_name', 'groupname'].includes(key)) raw.group = value
    else if (key.includes('identity') || key.includes('privatekey')) raw.keyFile = value
    else if (key.includes('auth')) raw.authType = value
    else if (key.includes('comment')) raw.comment = value
  }
  return normalizeDraft(raw, index)
}

const parseJsonImport = (content: string): ImportedAssetDraft[] => {
  const parsed = JSON.parse(content)
  const rows: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.assets) ? parsed.assets : Array.isArray(parsed?.sessions) ? parsed.sessions : []
  return rows
    .map((row, index) => (row && typeof row === 'object' ? normalizeDraft(row as Record<string, unknown>, index) : null))
    .filter((row): row is ImportedAssetDraft => Boolean(row))
}

const parseCsvImport = (content: string): ImportedAssetDraft[] => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return []
  const firstColumns = lines[0].split(/[,;\t]/).map((part) => cleanValue(part).toLowerCase())
  const hasHeader = firstColumns.some((column) => ['host', 'ip', 'address', 'hostname'].includes(column))
  const dataLines = hasHeader ? lines.slice(1) : lines
  if (!hasHeader) return dataLines.map(parseDelimitedLine).filter((row): row is ImportedAssetDraft => Boolean(row))
  return dataLines
    .map((line, index) => {
      const values = line.split(/[,;\t]/).map(cleanValue)
      const raw: Record<string, unknown> = {}
      firstColumns.forEach((column, columnIndex) => {
        raw[column] = values[columnIndex]
      })
      return normalizeDraft(raw, index)
    })
    .filter((row): row is ImportedAssetDraft => Boolean(row))
}

const parseXshellXsh = (content: string, fileName: string): ImportedAssetDraft[] => {
  const sessions: ParsedSession[] = []
  const sessionFromBlock = (block: string, fallbackName: string): ParsedSession | null => {
    const session: ParsedSession = {
      name: fallbackName.replace(/\.xsh$/i, ''),
      host: '',
      port: 22,
      username: 'root',
      authType: 'password',
      protocol: 'SSH'
    }
    for (const line of block.split(/\r?\n/)) {
      const equalIndex = line.indexOf('=')
      if (equalIndex < 0) continue
      const key = line.slice(0, equalIndex).trim()
      const value = cleanValue(line.slice(equalIndex + 1))
      if (key === 'Host') session.host = value
      else if (key === 'Port') session.port = normalizePort(value)
      else if (key === 'UserName') session.username = value || 'root'
      else if (key === 'Method') session.authType = normalizeAuthType(value)
      else if (key === 'PrivateKeyFile' && value) {
        session.keyFile = value
        session.authType = 'keyBased'
      } else if (key === 'Protocol') session.protocol = value || 'SSH'
      else if (key === 'Description' && value && value !== 'Xshell session file') session.name = value
    }
    return session.host ? session : null
  }

  if (content.includes('[SessionInfo]')) {
    const session = sessionFromBlock(content, fileName)
    if (session) sessions.push(session)
  } else {
    content
      .split(/\r?\n(?=\[CONNECTION\])/)
      .map((block) => block.trim())
      .filter(Boolean)
      .forEach((block, index) => {
        const session = sessionFromBlock(block, `Session ${index + 1}`)
        if (session) sessions.push(session)
      })
  }
  return sessions.map(sessionToDraft).filter((row): row is ImportedAssetDraft => Boolean(row))
}

const parseXshellTextArchive = (content: string): ImportedAssetDraft[] => {
  const sessions = new Map<string, ParsedSession>()
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    const ipMatch = trimmed.match(/(?<host>(?:\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9_.-]+\.[a-zA-Z0-9_.-]+)/)
    if (!ipMatch?.groups?.host) continue
    const userMatch = trimmed.match(/(?:user|username)[=:]\s*([^,;\s]+)/i) || trimmed.match(/([^@\s]+)@(?:\d{1,3}\.){3}\d{1,3}/)
    const portMatch = trimmed.match(/(?::|port[=:])\s*(\d+)/i)
    const host = ipMatch.groups.host
    const port = normalizePort(portMatch?.[1], 22)
    const key = `${host}:${port}`
    if (!sessions.has(key)) {
      sessions.set(key, {
        name: key,
        host,
        port,
        username: cleanValue(userMatch?.[1] || 'root'),
        authType: 'password',
        protocol: 'SSH'
      })
    }
  }
  return Array.from(sessions.values()).map(sessionToDraft).filter((row): row is ImportedAssetDraft => Boolean(row))
}

const parseSecureCrtIni = (content: string, fileName: string): ImportedAssetDraft[] => {
  const sessions: ParsedSession[] = []
  let current: ParsedSession = {
    name: fileName.replace(/\.ini$/i, ''),
    host: '',
    port: 22,
    username: 'root',
    authType: 'password',
    protocol: 'SSH'
  }
  const pushCurrent = () => {
    if (current.host) sessions.push({ ...current })
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sectionMatch = trimmed.match(/^\[Sessions\\(.+)]$/i)
    if (sectionMatch) {
      pushCurrent()
      current = { name: sectionMatch[1], host: '', port: 22, username: 'root', authType: 'password', protocol: 'SSH' }
      continue
    }
    const equalIndex = trimmed.indexOf('=')
    if (equalIndex < 0) continue
    const key = trimmed.slice(0, equalIndex).trim().replace(/^[SD]:/, '').replace(/"/g, '')
    const value = cleanValue(trimmed.slice(equalIndex + 1)).replace(/"/g, '')
    if (key === 'Hostname') current.host = value
    else if (key === 'Port') current.port = normalizePort(value)
    else if (key === 'Username') current.username = value || 'root'
    else if (key === 'Protocol Name') current.protocol = value
    else if (key === 'Auth Method' && !current.keyFile) current.authType = normalizeAuthType(value)
    else if (key === 'Identity Filename V2' && value) {
      current.keyFile = value
      current.authType = 'keyBased'
    }
  }
  pushCurrent()
  return sessions.map(sessionToDraft).filter((row): row is ImportedAssetDraft => Boolean(row))
}

const parseXmlAttributes = (text: string) => {
  const attributes: Record<string, string> = {}
  text.replace(/([a-zA-Z0-9_-]+)="([^"]*)"/g, (_, key: string, value: string) => {
    attributes[key] = decodeTextEntities(value)
    return ''
  })
  return attributes
}

const parseSecureCrtXml = (content: string): ImportedAssetDraft[] => {
  const sessions: ParsedSession[] = []
  const keyBlocks = content.match(/<key name="[^"]*"[^>]*>[\s\S]*?<\/key>/gi) || []
  for (const block of keyBlocks) {
    const name = block.match(/<key name="([^"]*)"/i)?.[1]
    if (!name || name === 'Sessions') continue
    const host = block.match(/<string name="Hostname">([^<]*)<\/string>/i)?.[1]
    const username = block.match(/<string name="Username">([^<]*)<\/string>/i)?.[1] || 'root'
    if (!host) continue
    const keyFile = block.match(/<string name="Identity Filename V2">([^<]*)<\/string>/i)?.[1]
    sessions.push({
      name: decodeTextEntities(name),
      host: decodeTextEntities(host),
      port: normalizePort(block.match(/<dword name="Port">(\d+)<\/dword>/i)?.[1]),
      username: decodeTextEntities(username),
      authType: normalizeAuthType(block.match(/<string name="Auth Method">([^<]*)<\/string>/i)?.[1], keyFile),
      keyFile,
      protocol: 'SSH'
    })
  }
  if (!sessions.length) {
    const sessionBlocks = content.match(/<session\b[^>]*>[\s\S]*?<\/session>/gi) || []
    for (const block of sessionBlocks) {
      const attrs = parseXmlAttributes(block.match(/<session\b([^>]*)>/i)?.[1] || '')
      const host = block.match(/<hostname>(.*?)<\/hostname>/i)?.[1] || attrs.host || attrs.hostname
      const username = block.match(/<username>(.*?)<\/username>/i)?.[1] || attrs.username || 'root'
      if (!host) continue
      sessions.push({
        name: block.match(/<name>(.*?)<\/name>/i)?.[1] || attrs.name || host,
        host,
        port: normalizePort(block.match(/<port>(.*?)<\/port>/i)?.[1] || attrs.port),
        username,
        authType: 'password',
        protocol: 'SSH'
      })
    }
  }
  return sessions.map(sessionToDraft).filter((row): row is ImportedAssetDraft => Boolean(row))
}

const parseMobaEncodedLine = (line: string): ImportedAssetDraft | null => {
  const equalIndex = line.indexOf('=')
  if (equalIndex < 0) return null
  const sessionName = cleanValue(line.slice(0, equalIndex))
  const encodedData = cleanValue(line.slice(equalIndex + 1))
  if (encodedData.startsWith('#109#0%')) {
    const parts = encodedData.slice(7).split('%')
    const keyFile = parts.find((part, index) => index > 9 && part && part !== '-1' && (part.startsWith('_ProfileDir_') || isPrivateKeyHint(part)))
    const gatewayHost = parts[5] && parts[5] !== '-1' ? parts[5] : ''
    return normalizeDraft(
      {
        title: sessionName,
        host: parts[0],
        port: normalizePort(parts[9] || parts[1] || 22),
        username: parts[2] || 'root',
        password: parts[3] && parts[3] !== '-1' ? parts[3] : '',
        keyFile,
        proxyHost: gatewayHost,
        proxyPort: parts[6] || 22,
        comment: keyFile || ''
      },
      0
    )
  }
  const raw: Record<string, unknown> = { title: sessionName }
  for (const segment of line.split('%')) {
    const [key, value] = segment.split('=', 2)
    if (!value) continue
    const lowerKey = key.trim().toLowerCase()
    if (lowerKey.includes('serverhost')) raw.host = value
    else if (lowerKey.includes('username')) raw.username = value
    else if (lowerKey.includes('portnum')) raw.port = value
    else if (lowerKey.includes('sessionname')) raw.title = value
  }
  return normalizeDraft(raw, 0)
}

const parseMobaXterm = (content: string): ImportedAssetDraft[] =>
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== '[Bookmarks]' && !line.startsWith('SubRep=') && !line.startsWith('ImgNum=') && !/^\[Bookmarks_\d+]$/.test(line))
    .map(parseMobaEncodedLine)
    .filter((row): row is ImportedAssetDraft => Boolean(row))

const parseTextImport = (content: string, fileName: string): ImportedAssetDraft[] => {
  const blocks = content
    .split(/\n\s*\n|\r?\n(?=\[)/)
    .map((block) => block.trim())
    .filter(Boolean)
  const keyValueRows = blocks
    .map((block, index) => parseGenericKeyValueBlock(block, fileName.replace(/\.[^.]+$/, ''), index))
    .filter((row): row is ImportedAssetDraft => Boolean(row))
  if (keyValueRows.length) return keyValueRows
  return content
    .split(/\r?\n/)
    .map(parseDelimitedLine)
    .filter((row): row is ImportedAssetDraft => Boolean(row))
}

export const parseAssetImportContent = (content: string, fileName: string): ImportedAssetDraft[] => {
  const lowerName = fileName.toLowerCase()
  const ext = lowerName.split('.').pop() || ''
  if (ext === 'json') return parseJsonImport(content)
  if (ext === 'csv') return parseCsvImport(content)
  if (ext === 'xsh') return parseXshellXsh(content, fileName)
  if (ext === 'xts') return parseXshellTextArchive(content)
  if (ext === 'ini') {
    const secureCrtRows = parseSecureCrtIni(content, fileName)
    return secureCrtRows.length ? secureCrtRows : parseTextImport(content, fileName)
  }
  if (ext === 'xml') return parseSecureCrtXml(content)
  if (ext === 'mxtsessions' || lowerName.includes('mobaxterm')) return parseMobaXterm(content)
  return parseTextImport(content, fileName)
}
