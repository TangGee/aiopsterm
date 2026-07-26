export type Disposable = {
  dispose(): void
}

export type Memento = {
  get<T>(key: string, defaultValue?: T): Promise<T | undefined>
  update(key: string, value: unknown): Promise<void>
  keys(): Promise<string[]>
}

export type TreeItem = {
  id: string
  label: string
  description?: string
  tooltip?: string
  icon?: string
  collapsibleState?: 'none' | 'collapsed' | 'expanded'
  contextValue?: string
  command?: string
  commandArgs?: unknown[]
}

export type TreeDataProvider = {
  getChildren(parentId?: string): TreeItem[] | Promise<TreeItem[]>
}

export type AssetInput = {
  id: string
  name: string
  title?: string
  host: string
  ip?: string
  port?: number
  username?: string
  group?: string
  group_name?: string
  status?: 'online' | 'offline' | 'unknown'
  asset_type?: 'person' | 'organization' | 'switch'
  auth_type?: 'password' | 'keyBased'
  data_source?: string
  comment?: string
  tags?: string[]
  [key: string]: unknown
}

export type AssetProvider = {
  sync(
    values: Record<string, string>,
    signal?: AbortSignal,
    reportProgress?: (percent: number, message?: string) => void
  ): AssetInput[] | { assets: AssetInput[]; removeMissing?: boolean } | Promise<AssetInput[] | { assets: AssetInput[]; removeMissing?: boolean }>
}

export type BastionProvider = {
  connect?(input: Record<string, unknown>): unknown | Promise<unknown>
  openShell?(input: Record<string, unknown>): unknown | Promise<unknown>
  write?(input: Record<string, unknown>): unknown | Promise<unknown>
  resize?(input: Record<string, unknown>): unknown | Promise<unknown>
  disconnect?(input: Record<string, unknown>): unknown | Promise<unknown>
  refreshAssets?(input: Record<string, unknown>): unknown | Promise<unknown>
}

export type BastionDefinition = {
  type: string
  displayName: string
  description?: string
  authPolicy?: 'password' | 'keyBased' | 'either'
  supportsRefresh?: boolean
  supportsShell?: boolean
}

export type ExtensionContext = {
  pluginId: string
  extensionPath: string
  storagePath: string
  subscriptions: Disposable[]
  asAbsolutePath(relativePath: string): string
  logger: {
    info(message: string, data?: unknown): void
    warn(message: string, data?: unknown): void
    error(message: string, data?: unknown): void
  }
  globalState: Memento
  workspaceState: Memento
  secrets: {
    get(key: string): Promise<string | undefined>
    store(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
    keys(): Promise<string[]>
  }
  commands: {
    registerCommand(commandId: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): Disposable
    executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>
  }
  views: {
    registerTreeDataProvider(viewId: string, provider: TreeDataProvider): Disposable
    refresh(viewId: string): void
  }
  contexts: {
    set(key: string, value: boolean | string | number): void
  }
  configuration: {
    get<T extends string | boolean>(key: string, defaultValue?: T): Promise<T | undefined>
    update(key: string, value: string | boolean): Promise<void>
  }
  files: {
    readFile(filePath: string): Promise<Buffer>
    writeFile(filePath: string, content: string | Buffer): Promise<void>
  }
  assets: {
    registerProvider(providerId: string, provider: AssetProvider): Disposable
    save(asset: AssetInput): unknown
  }
  bastions: {
    registerDefinition(definition: BastionDefinition): Disposable
    registerProvider(type: string, provider: BastionProvider): Disposable
  }
  versions: {
    registerProvider(provider: () => unknown | Promise<unknown>): Disposable
  }
  window: {
    showInformationMessage(message: string): void
    showWarningMessage(message: string): void
    showErrorMessage(message: string): void
  }
}

export type ExtensionModule = {
  activate(context: ExtensionContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
