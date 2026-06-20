import { describe, expect, it } from 'vitest'
import {
  affectedFileTransferTaskIds,
  cloneFileSessionCatalog,
  defaultFileOpenSide,
  defaultFileSessionSide,
  fileTransferOverallPercent,
  fileTransferTaskRemovalDelay,
  fileSessionPanelStatus,
  fileSessionTerminalContextForPanel,
  fileBrowserDirname,
  fileBrowserEntryDropDirectory,
  fileBrowserRenamePath,
  fileBrowserRowsForDirectory,
  fileBrowserTargetBreadcrumb,
  fileBrowserTargetPathForBreadcrumbIndex,
  filePermissionCode,
  findFileSessionForSftpPayload,
  findFileSession,
  formatFileModifiedAt,
  formatFileSize,
  groupFileTransferTasks,
  hasRunningFileTransferTasks,
  isDraggableFileBrowserEntry,
  isSelectedFileSessionSftpPayload,
  joinFileBrowserPath,
  localPathName,
  markFileTransferTasksCancelled,
  mergeFileTransferTaskSnapshot,
  nextSelectedFileSessionIds,
  nextFileBrowserSortState,
  normalizeFileSessionFolderSaveInput,
  normalizeFileBrowserPath,
  normalizeFileTransferTask,
  normalizeFileTransferTaskSnapshot,
  openFileSessionSelection,
  parseFilePermissionMode,
  permissionToModePrefix,
  selectedFileSessionSnapshot,
  uniqueConflictFileName,
  visibleFileBrowserEntries,
  upsertFileTransferTask,
  type FileBrowserEntry
} from '@/services/filesRuntime'
import type { FileSessionCatalog, FileTransferTask } from '@shared/contracts/files'
import type { TerminalPanel } from '@/services/terminalPanelRuntime'

const catalog: FileSessionCatalog = {
  folders: [
    { uuid: 'folder-a', name: 'Folder A', description: 'A' },
    { uuid: 'folder-b', name: 'Folder B', description: 'B' }
  ],
  sessions: [
    {
      id: 'local',
      label: 'Local',
      host: 'localhost',
      group: 'Local',
      kind: 'local',
      rootPath: '/',
      status: 'active'
    },
    {
      id: 'asset-1',
      label: 'prod',
      host: '10.0.0.1',
      group: 'Prod',
      kind: 'remote',
      rootPath: '/home/deploy',
      status: 'active',
      folderUuid: 'folder-a'
    }
  ]
}

const task = (input: Partial<FileTransferTask> & Pick<FileTransferTask, 'id' | 'type' | 'status' | 'progress'>): FileTransferTask => ({
  name: input.id,
  source: `/src/${input.id}`,
  target: `/dst/${input.id}`,
  speed: input.status === 'running' ? 'pending' : '',
  ...input
})

describe('filesRuntime', () => {
  it('clones catalogs and resolves selected file sessions without aliasing inputs', () => {
    const cloned = cloneFileSessionCatalog(catalog)
    cloned.sessions[0].label = 'Changed'
    cloned.folders[0].name = 'Changed'

    expect(catalog.sessions[0].label).toBe('Local')
    expect(catalog.folders[0].name).toBe('Folder A')
    expect(findFileSession(catalog.sessions, 'asset-1')?.host).toBe('10.0.0.1')
    expect(findFileSession(catalog.sessions, 'missing')).toBeNull()
  })

  it('normalizes selected sides after catalog refresh and open-session requests', () => {
    expect(nextSelectedFileSessionIds(catalog.sessions, 'asset-1', 'missing')).toEqual({ left: 'asset-1', right: 'local' })
    expect(nextSelectedFileSessionIds(catalog.sessions.filter((session) => session.id !== 'local'), 'missing', 'missing')).toEqual({
      left: null,
      right: 'asset-1'
    })
    expect(defaultFileSessionSide(null, 'local')).toBe('left')
    expect(defaultFileSessionSide('asset-1', null)).toBe('right')
    expect(defaultFileSessionSide('asset-1', 'local')).toBe('left')
    expect(defaultFileOpenSide(null)).toBe('left')
    expect(defaultFileOpenSide('asset-1')).toBe('right')

    expect(openFileSessionSelection(catalog.sessions, 'asset-1', 'left', null, 'local')).toEqual({
      left: 'asset-1',
      right: 'local',
      session: catalog.sessions[1]
    })
    expect(openFileSessionSelection(catalog.sessions, 'missing', 'right', 'asset-1', 'local')).toEqual({
      left: 'asset-1',
      right: 'local',
      session: null
    })
  })

  it('matches SFTP payloads to known or selected sessions', () => {
    expect(findFileSessionForSftpPayload(catalog.sessions, { assetId: 'asset-1' })).toBe(catalog.sessions[1])
    expect(findFileSessionForSftpPayload(catalog.sessions, { ip: '10.0.0.1' })).toBe(catalog.sessions[1])
    expect(findFileSessionForSftpPayload(catalog.sessions, { uuid: 'missing', host: '10.0.0.99' })).toBeNull()

    const selection = selectedFileSessionSnapshot(catalog.sessions, 'asset-1', 'local')
    expect(selection.leftSession).toBe(catalog.sessions[1])
    expect(selection.rightSession).toBe(catalog.sessions[0])
    expect(isSelectedFileSessionSftpPayload(selection, { id: 'asset-1' })).toBe(true)
    expect(isSelectedFileSessionSftpPayload(selection, { host: 'localhost' })).toBe(true)
    expect(isSelectedFileSessionSftpPayload(selection, { host: '10.0.0.99' })).toBe(false)
  })

  it('normalizes file session folder save inputs', () => {
    expect(
      normalizeFileSessionFolderSaveInput({
        uuid: 'folder-a',
        name: '  发布窗口  ',
        description: '  release files ',
        parentUuid: 'root',
        scope: 'direct'
      })
    ).toEqual({
      uuid: 'folder-a',
      name: '发布窗口',
      description: 'release files',
      parentUuid: 'root',
      scope: 'direct'
    })
    expect(normalizeFileSessionFolderSaveInput({ name: '   ' })).toBeNull()
  })

  it('creates terminal-panel file session contexts without backend side effects', () => {
    const localPanel: TerminalPanel = {
      id: 'panel-local',
      title: 'zsh',
      cwd: '/home/unit',
      output: '',
      outputSegments: [],
      status: 'running',
      kind: 'terminal',
      sessionId: 'terminal-local-unit'
    }
    expect(fileSessionPanelStatus('connecting')).toBe('running')
    expect(fileSessionPanelStatus('error')).toBe('closed')
    expect(fileSessionTerminalContextForPanel(localPanel)).toEqual({
      kind: 'local',
      panelId: 'panel-local',
      panelTitle: 'zsh',
      panelStatus: 'running',
      sessionId: 'terminal-local-unit',
      cwd: '/home/unit'
    })

    const pendingSshPanel: TerminalPanel = {
      ...localPanel,
      id: 'panel-pending',
      title: 'pending-host',
      status: 'connecting',
      sshSession: {
        host: '10.0.0.2',
        port: 22,
        username: 'deploy',
        assetId: 'asset-pending',
        assetName: 'pending-host'
      }
    }
    expect(fileSessionTerminalContextForPanel(pendingSshPanel)).toEqual({
      kind: 'ssh',
      panelId: 'panel-pending',
      panelTitle: 'pending-host',
      panelStatus: 'running',
      sessionId: undefined,
      cwd: undefined,
      ssh: {
        connectionId: undefined,
        host: '10.0.0.2',
        port: 22,
        username: 'deploy',
        assetId: 'asset-pending',
        assetName: 'pending-host',
        assetType: undefined,
        organizationId: undefined,
        jumpHostId: undefined,
        authType: undefined,
        needProxy: undefined,
        proxyName: undefined,
        createdAt: undefined,
        forkFromConnectionId: undefined
      }
    })

    const connectedSshPanel: TerminalPanel = {
      ...pendingSshPanel,
      sessionId: 'terminal-ssh-unit',
      cwd: '/home/deploy',
      sshSession: {
        ...pendingSshPanel.sshSession!,
        connectionId: 'ssh-terminal-ssh-unit',
        assetType: 'person',
        organizationId: 'prod',
        jumpHostId: 'jump-1',
        authType: 'keyBased',
        needProxy: true,
        proxyName: 'release-proxy',
        createdAt: 1717200001000,
        forkFromConnectionId: 'ssh-parent'
      }
    }
    expect(fileSessionTerminalContextForPanel(connectedSshPanel)).toEqual({
      kind: 'ssh',
      panelId: 'panel-pending',
      panelTitle: 'pending-host',
      panelStatus: 'running',
      sessionId: 'terminal-ssh-unit',
      cwd: '/home/deploy',
      ssh: {
        connectionId: 'ssh-terminal-ssh-unit',
        host: '10.0.0.2',
        port: 22,
        username: 'deploy',
        assetId: 'asset-pending',
        assetName: 'pending-host',
        assetType: 'person',
        organizationId: 'prod',
        jumpHostId: 'jump-1',
        authType: 'keyBased',
        needProxy: true,
        proxyName: 'release-proxy',
        createdAt: 1717200001000,
        forkFromConnectionId: 'ssh-parent'
      }
    })
  })

  it('derives FileBrowser visible rows, sorting, and permission state', () => {
    const rows: FileBrowserEntry[] = [
      { name: '..', path: '/', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '', modifiedAtMs: 0 },
      { name: '.env', path: '/work/.env', type: 'file', mode: '-rw-r--r--', size: 10, modifiedAt: '2024-01-01 00:00', modifiedAtMs: 1000 },
      { name: 'src', path: '/work/src', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2024-01-01 00:01', modifiedAtMs: 2000 },
      { name: 'readme.md', path: '/work/readme.md', type: 'file', mode: '-rw-r--r--', size: 5, modifiedAt: '2024-01-01 00:02', modifiedAtMs: 3000 },
      { name: 'release', path: '/work/release', type: 'link', mode: 'lrwxrwxrwx', size: 0, modifiedAt: '2024-01-01 00:03', modifiedAtMs: 4000 }
    ]

    expect(visibleFileBrowserEntries(rows, false, { key: 'name', direction: 'asc' }).map((entry) => entry.name)).toEqual([
      '..',
      'src',
      'release',
      'readme.md'
    ])
    expect(visibleFileBrowserEntries(rows, true, { key: 'size', direction: 'desc' }).map((entry) => entry.name)).toEqual([
      '..',
      'src',
      'release',
      '.env',
      'readme.md'
    ])
    expect(nextFileBrowserSortState({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' })
    expect(nextFileBrowserSortState({ key: 'name', direction: 'asc' }, 'modifiedAt')).toEqual({ key: 'modifiedAt', direction: 'desc' })
    expect(permissionToModePrefix('directory')).toBe('d')
    expect(permissionToModePrefix('link')).toBe('l')
    expect(permissionToModePrefix('file')).toBe('-')
    expect(filePermissionCode({ owner: ['读', '写', '执行'], group: ['读', '执行'], public: ['读'] })).toBe('754')
    expect(parseFilePermissionMode('754')).toEqual({ owner: ['读', '写', '执行'], group: ['读', '执行'], public: ['读'] })
    expect(parseFilePermissionMode('bad-mode')).toBeNull()
  })

  it('derives FileBrowser paths, directory rows, and transfer targets', () => {
    expect(normalizeFileBrowserPath(' /tmp//release/ ')).toBe('/tmp/release/')
    expect(normalizeFileBrowserPath('   ')).toBe('/')
    expect(joinFileBrowserPath('/tmp/', '/release', 'build.tgz')).toBe('/tmp/release/build.tgz')
    expect(fileBrowserDirname('/tmp/release/build.tgz')).toBe('/tmp/release')
    expect(fileBrowserDirname('/tmp')).toBe('/')
    expect(fileBrowserRenamePath('/tmp/old.txt', 'new.txt')).toBe('/tmp/new.txt')
    expect(fileBrowserTargetBreadcrumb('/tmp/release')).toEqual(['/', 'tmp', 'release'])
    expect(fileBrowserTargetPathForBreadcrumbIndex('/tmp/release', 0)).toBe('/')
    expect(fileBrowserTargetPathForBreadcrumbIndex('/tmp/release', 2)).toBe('/tmp/release')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatFileModifiedAt(new Date(2024, 0, 2, 3, 4).getTime())).toBe('2024-01-02 03:04')
    expect(localPathName('/tmp/release/build.tgz')).toBe('build.tgz')
    expect(localPathName('', 'fallback.txt')).toBe('fallback.txt')

    const listed = fileBrowserRowsForDirectory('/requested', [
      { name: 'app.log', path: '/var/log/app.log', type: 'file', size: 128, modifiedAt: 1717200000000 },
      { name: 'app', path: '/var/log/app', type: 'directory', mode: 'drwx------', size: 0, modifiedAt: 1717200001000 }
    ])
    expect(listed.path).toBe('/var/log')
    expect(listed.rows[0]).toEqual({ name: '..', path: '/var', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '', modifiedAtMs: 0 })
    expect(listed.rows[1]).toEqual({
      name: 'app.log',
      path: '/var/log/app.log',
      type: 'file',
      mode: '-rw-r--r--',
      size: 128,
      modifiedAt: expect.any(String),
      modifiedAtMs: 1717200000000,
      linkTarget: undefined
    })

    expect(fileBrowserEntryDropDirectory(listed.rows[2], '/var/log')).toBe('/var/log/app')
    expect(fileBrowserEntryDropDirectory(listed.rows[1], '/var/log')).toBe('/var/log')
    expect(isDraggableFileBrowserEntry(listed.rows[1], 'transfer', 'left')).toBe(true)
    expect(isDraggableFileBrowserEntry({ ...listed.rows[1], type: 'link' }, 'transfer', 'left')).toBe(false)
    expect(isDraggableFileBrowserEntry(listed.rows[1], 'default', 'left')).toBe(false)
    expect(uniqueConflictFileName(['report.txt', 'report_1.txt'], 'report.txt')).toBe('report_2.txt')
  })

  it('groups transfer tasks and derives aggregate progress and running state', () => {
    const tasks = [
      task({ id: 'download-1', type: 'download', status: 'running', progress: 10 }),
      task({ id: 'upload-1', type: 'upload', status: 'success', progress: 100 }),
      task({ id: 'r2r-1', type: 'r2r', status: 'failed', progress: 50 })
    ]

    expect(groupFileTransferTasks(tasks)).toEqual({
      download: [tasks[0]],
      upload: [tasks[1]],
      r2r: [tasks[2]]
    })
    expect(fileTransferOverallPercent(tasks)).toBe(53)
    expect(fileTransferOverallPercent([])).toBe(0)
    expect(hasRunningFileTransferTasks(tasks)).toBe(true)
    expect(hasRunningFileTransferTasks(tasks.slice(1))).toBe(false)
  })

  it('normalizes transfer tasks, children, defaults, and bounded numeric fields', () => {
    const normalized = normalizeFileTransferTask({
      id: '  task-1  ',
      type: 'download',
      name: '  release.tgz ',
      source: '/release.tgz',
      target: '/tmp/release.tgz',
      progress: 150.4,
      speed: '',
      status: 'unknown',
      stage: 'scanning',
      isGroup: true,
      totalFiles: 2.6,
      finishedFiles: -5,
      children: [
        {
          id: 'child-1',
          type: 'download',
          name: 'child',
          source: '/child',
          target: '/tmp/child',
          progress: -10,
          speed: '1KB/s',
          status: 'success'
        },
        { id: '', type: 'download' }
      ]
    })

    expect(normalized).toEqual({
      id: 'task-1',
      type: 'download',
      name: 'release.tgz',
      source: '/release.tgz',
      target: '/tmp/release.tgz',
      progress: 100,
      speed: 'pending',
      status: 'running',
      stage: 'scanning',
      isGroup: true,
      totalFiles: 3,
      finishedFiles: 0,
      children: [
        {
          id: 'child-1',
          type: 'download',
          name: 'child',
          source: '/child',
          target: '/tmp/child',
          progress: 0,
          speed: '1KB/s',
          status: 'success'
        }
      ]
    })
    expect(normalizeFileTransferTask({ id: 'bad' })).toBeNull()
    expect(normalizeFileTransferTaskSnapshot([normalized, { id: 'bad' }])).toEqual([normalized])
  })

  it('merges snapshots, upserts tasks, schedules removal classes, and marks cancellations', () => {
    const running = task({ id: 'running', type: 'download', status: 'running', progress: 20 })
    const oldFinished = task({ id: 'old-success', type: 'upload', status: 'success', progress: 100 })
    const snapshot = [task({ id: 'running', type: 'download', status: 'running', progress: 30 })]

    expect(mergeFileTransferTaskSnapshot([running, oldFinished], snapshot)).toEqual([snapshot[0], oldFinished])
    expect(mergeFileTransferTaskSnapshot([running, oldFinished], snapshot, { replaceCompleted: true })).toEqual(snapshot)
    expect(upsertFileTransferTask([running, oldFinished], task({ id: 'running', type: 'download', status: 'success', progress: 100 }))).toEqual([
      task({ id: 'running', type: 'download', status: 'success', progress: 100 }),
      oldFinished
    ])
    expect(fileTransferTaskRemovalDelay(task({ id: 'success', type: 'upload', status: 'success', progress: 100 }))).toBe(2500)
    expect(fileTransferTaskRemovalDelay(task({ id: 'failed', type: 'upload', status: 'failed', progress: 50 }))).toBe(8000)
    expect(fileTransferTaskRemovalDelay(running)).toBeNull()
  })

  it('resolves affected task ids and applies cancelled state to grouped tasks', () => {
    const parent: FileTransferTask = {
      ...task({ id: 'parent', type: 'download', status: 'running', progress: 80 }),
      children: [
        task({ id: 'child-a', type: 'download', status: 'running', progress: 90 }),
        task({ id: 'child-b', type: 'download', status: 'running', progress: 40 })
      ]
    }
    const standalone = task({ id: 'standalone', type: 'upload', status: 'running', progress: 60 })

    expect([...affectedFileTransferTaskIds([parent, standalone], 'child-a')]).toEqual(['child-a', 'parent', 'child-b'])
    expect([...affectedFileTransferTaskIds([parent, standalone], 'parent')]).toEqual(['parent', 'child-a', 'child-b'])

    const cancelled = markFileTransferTasksCancelled([parent, standalone], ['parent'])
    expect(cancelled[0]).toEqual({
      ...parent,
      status: 'failed',
      speed: '已取消',
      progress: 80,
      children: [
        { ...parent.children![0], status: 'failed', speed: '已取消', progress: 90 },
        { ...parent.children![1], status: 'failed', speed: '已取消', progress: 40 }
      ]
    })
    expect(cancelled[1]).toBe(standalone)
  })
})
