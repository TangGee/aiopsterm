<template>
  <aside
    class="db-sidebar"
    :class="{ collapsed: sidebarCollapsed }"
  >
    <template v-if="!sidebarCollapsed">
      <header class="db-sidebar-header">
        <strong>Database</strong>
        <div class="db-sidebar-actions">
          <button
            type="button"
            title="Refresh connected"
            @click="$emit('refreshConnected')"
          >
            <RefreshCw />
          </button>
          <button
            ref="addButtonRef"
            type="button"
            title="Add"
            @click.stop="$emit('toggleAddMenu', $event)"
          >
            <Plus />
          </button>
          <button
            type="button"
            title="Collapse"
            @click="$emit('updateSidebarCollapsed', true)"
          >
            <PanelLeftClose />
          </button>
        </div>
      </header>

      <div class="db-search">
        <Search />
        <input
          ref="searchInputRef"
          :value="keyword"
          placeholder="Search"
          @input="$emit('updateKeyword', ($event.target as HTMLInputElement).value)"
          @keydown.esc.prevent="clearSearch"
        />
        <button
          v-if="keyword"
          class="db-search-clear"
          type="button"
          title="Clear search"
          @click="clearSearch"
        >
          <X />
        </button>
      </div>

      <nav class="db-tree">
        <ul>
          <li
            v-for="group in visibleGroupNodes"
            :key="group.id"
          >
            <div
              class="db-tree-row group"
              :class="{ selected: selectedNodeId === group.id }"
              :style="{ paddingLeft: `${6 + group.depth * 14}px` }"
              @click="selectAndToggleGroup(group.id)"
              @contextmenu.prevent="$emit('openContextMenu', $event, { type: 'group', groupId: group.id, label: group.name })"
            >
              <button
                type="button"
                @click.stop="$emit('toggleGroup', group.id)"
              >
                <ChevronDown v-if="expandedGroups.includes(group.id)" />
                <ChevronRight v-else />
              </button>
              <FolderOpen v-if="expandedGroups.includes(group.id)" />
              <Folder v-else />
              <input
                v-if="editingGroupId === group.id"
                :value="editingGroupName"
                class="db-tree-edit"
                @click.stop
                @input="$emit('updateEditingGroupName', ($event.target as HTMLInputElement).value)"
                @keydown.enter.prevent="$emit('commitGroupRename')"
                @keydown.esc.prevent="$emit('cancelGroupRename')"
                @blur="$emit('commitGroupRename')"
              />
              <span v-else>{{ group.name }}</span>
            </div>

            <ul
              v-if="expandedGroups.includes(group.id)"
              class="db-tree-children"
              :style="{ paddingLeft: `${12 + group.depth * 14}px` }"
            >
              <li
                v-for="connection in connectionsByGroup(group.id)"
                :key="connection.id"
              >
                <div
                  class="db-tree-row connection"
                  :class="{ selected: selectedNodeId === connection.id }"
                  @click="selectAndToggleConnection(connection.id)"
                  @contextmenu.prevent="$emit('openContextMenu', $event, { type: 'connection', connectionId: connection.id, label: connection.name })"
                >
                  <button
                    type="button"
                    @click.stop="$emit('toggleConnection', connection.id)"
                  >
                    <ChevronDown v-if="expandedConnections.includes(connection.id)" />
                    <ChevronRight v-else />
                  </button>
                  <span
                    class="db-engine-dot"
                    :style="{ background: engineAccent(connection.dbType) }"
                  />
                  <span>{{ connection.name }}</span>
                  <span
                    class="db-status-dot"
                    :class="connection.status"
                  />
                  <button
                    class="db-tree-connect"
                    type="button"
                    :title="connection.status === 'connected' ? 'Disconnect' : 'Connect'"
                    @click.stop="$emit('toggleConnectionStatus', connection.id)"
                  >
                    <Unplug v-if="connection.status === 'connected'" />
                    <Zap v-else />
                  </button>
                </div>

                <ul
                  v-if="expandedConnections.includes(connection.id)"
                  class="db-tree-children deep"
                >
                  <li
                    v-for="catalog in connection.catalogs"
                    :key="`${connection.id}:${catalog.name}`"
                  >
                    <div
                      v-if="!isFlattenedSqliteConnection(connection)"
                      class="db-tree-row database"
                      :class="{ selected: selectedNodeId === `${connection.id}:${catalog.name}` }"
                      @click="selectAndToggleCatalog(connection.id, catalog.name)"
                    >
                      <button
                        type="button"
                        @click.stop="$emit('toggleCatalog', connection.id, catalog.name)"
                      >
                        <ChevronDown v-if="isCatalogExpanded(connection.id, catalog.name)" />
                        <ChevronRight v-else />
                      </button>
                      <Database />
                      <span>{{ databaseCatalogDisplayName(connection, catalog) }}</span>
                    </div>

                    <ul
                      v-if="isFlattenedSqliteConnection(connection) || isCatalogExpanded(connection.id, catalog.name)"
                      :class="{
                        'db-tree-children': !isFlattenedSqliteConnection(connection),
                        deep: !isFlattenedSqliteConnection(connection)
                      }"
                    >
                      <template v-if="catalog.schemas">
                        <li
                          v-for="schema in catalog.schemas"
                          :key="`${connection.id}:${catalog.name}:${schema.name}`"
                        >
                          <div
                            class="db-tree-row schema"
                            :class="{ selected: selectedNodeId === `${connection.id}:${catalog.name}:${schema.name}` }"
                            @click="selectAndToggleSchema(connection.id, catalog.name, schema.name)"
                          >
                            <button
                              type="button"
                              @click.stop="$emit('toggleSchema', connection.id, catalog.name, schema.name)"
                            >
                              <ChevronDown v-if="isSchemaExpanded(connection.id, catalog.name, schema.name)" />
                              <ChevronRight v-else />
                            </button>
                            <Network />
                            <span>{{ schema.name }}</span>
                          </div>

                          <ul
                            v-if="isSchemaExpanded(connection.id, catalog.name, schema.name)"
                            class="db-tree-children deep"
                          >
                            <li
                              v-for="folder in schemaObjectFolders(schema)"
                              :key="schemaObjectFolderKey(connection.id, catalog.name, schema.name, folder.kind)"
                            >
                              <div
                                class="db-tree-row folder"
                                :class="{ selected: selectedNodeId === schemaObjectFolderKey(connection.id, catalog.name, schema.name, folder.kind) }"
                                @click="selectAndToggleSchemaObjectFolder(connection.id, catalog.name, schema.name, folder.kind)"
                              >
                                <button
                                  type="button"
                                  @click.stop="$emit('toggleSchemaObjectFolder', connection.id, catalog.name, schema.name, folder.kind)"
                                >
                                  <ChevronDown v-if="isSchemaObjectFolderExpanded(connection.id, catalog.name, schema.name, folder.kind)" />
                                  <ChevronRight v-else />
                                </button>
                                <FolderOpen v-if="isSchemaObjectFolderExpanded(connection.id, catalog.name, schema.name, folder.kind)" />
                                <Folder v-else />
                                <span>{{ folder.kind }}</span>
                                <small>{{ folder.count }}</small>
                              </div>
                              <ul
                                v-if="isSchemaObjectFolderExpanded(connection.id, catalog.name, schema.name, folder.kind)"
                                class="db-tree-children deep"
                              >
                                <li
                                  v-for="table in folder.tables"
                                  :key="table.id"
                                >
                                  <div
                                    class="db-tree-row table"
                                    :class="{ selected: selectedNodeId === table.id }"
                                    @click="$emit('selectNode', table.id)"
                                    @dblclick="$emit('openTable', connection.id, catalog.name, table, schema.name)"
                                    @contextmenu.prevent="
                                      $emit('openContextMenu', $event, {
                                        type: 'table',
                                        connectionId: connection.id,
                                        catalogName: catalog.name,
                                        schemaName: schema.name,
                                        tableId: table.id,
                                        label: table.name
                                      })
                                    "
                                  >
                                    <button
                                      type="button"
                                      @click.stop="$emit('toggleTable', table.id)"
                                    >
                                      <ChevronDown v-if="isTableExpanded(table.id)" />
                                      <ChevronRight v-else />
                                    </button>
                                    <Table2 />
                                    <span>{{ table.name }}</span>
                                  </div>
                                  <ul
                                    v-if="isTableExpanded(table.id)"
                                    class="db-tree-children deep"
                                  >
                                    <li
                                      v-for="column in table.columns"
                                      :key="`${table.id}:${column.name}`"
                                    >
                                      <div
                                        class="db-tree-row column"
                                        :class="{ selected: selectedNodeId === columnNodeId(table.id, column.name) }"
                                        @click="$emit('selectColumnNode', table, column)"
                                      >
                                        <span class="db-tree-spacer" />
                                        <Columns3 />
                                        <span>{{ column.name }}</span>
                                        <small v-if="column.key">{{ column.key }}</small>
                                      </div>
                                    </li>
                                  </ul>
                                </li>
                                <li
                                  v-for="routine in folder.routines"
                                  :key="`${schemaObjectFolderKey(connection.id, catalog.name, schema.name, folder.kind)}:${routine}`"
                                >
                                  <div
                                    class="db-tree-row column"
                                    :class="{ selected: selectedNodeId === schemaRoutineNodeId(connection.id, catalog.name, schema.name, folder.kind, routine) }"
                                    @click="$emit('selectNode', schemaRoutineNodeId(connection.id, catalog.name, schema.name, folder.kind, routine))"
                                  >
                                    <span class="db-tree-spacer" />
                                    <Columns3 />
                                    <span>{{ routine }}</span>
                                  </div>
                                </li>
                              </ul>
                            </li>
                          </ul>
                        </li>
                      </template>

                      <li v-if="catalog.tables">
                        <div
                          class="db-tree-row folder"
                          :class="{
                            selected:
                              isFlattenedSqliteConnection(connection) &&
                              selectedNodeId === `${connection.id}:${catalog.name}`
                          }"
                          @click="isFlattenedSqliteConnection(connection) && selectAndToggleCatalog(connection.id, catalog.name)"
                        >
                          <button
                            v-if="isFlattenedSqliteConnection(connection)"
                            type="button"
                            @click.stop="$emit('toggleCatalog', connection.id, catalog.name)"
                          >
                            <ChevronDown v-if="isCatalogExpanded(connection.id, catalog.name)" />
                            <ChevronRight v-else />
                          </button>
                          <span
                            v-else
                            class="db-tree-spacer"
                          />
                          <FolderOpen
                            v-if="
                              !isFlattenedSqliteConnection(connection) ||
                                isCatalogExpanded(connection.id, catalog.name)
                            "
                          />
                          <Folder v-else />
                          <span>tables</span>
                        </div>
                        <ul
                          v-if="
                            !isFlattenedSqliteConnection(connection) ||
                              isCatalogExpanded(connection.id, catalog.name)
                          "
                          class="db-tree-children deep"
                        >
                          <li
                            v-for="table in catalog.tables"
                            :key="table.id"
                          >
                            <div
                              class="db-tree-row table"
                              :class="{ selected: selectedNodeId === table.id }"
                              @click="$emit('selectNode', table.id)"
                              @dblclick="$emit('openTable', connection.id, catalog.name, table)"
                              @contextmenu.prevent="
                                $emit('openContextMenu', $event, {
                                  type: 'table',
                                  connectionId: connection.id,
                                  catalogName: catalog.name,
                                  tableId: table.id,
                                  label: table.name
                                })
                              "
                            >
                              <button
                                type="button"
                                @click.stop="$emit('toggleTable', table.id)"
                              >
                                <ChevronDown v-if="isTableExpanded(table.id)" />
                                <ChevronRight v-else />
                              </button>
                              <Table2 />
                              <span>{{ table.name }}</span>
                            </div>
                            <ul
                              v-if="isTableExpanded(table.id)"
                              class="db-tree-children deep"
                            >
                              <li
                                v-for="column in table.columns"
                                :key="`${table.id}:${column.name}`"
                              >
                                <div
                                  class="db-tree-row column"
                                  :class="{ selected: selectedNodeId === columnNodeId(table.id, column.name) }"
                                  @click="$emit('selectColumnNode', table, column)"
                                >
                                  <span class="db-tree-spacer" />
                                  <Columns3 />
                                  <span>{{ column.name }}</span>
                                  <small v-if="column.key">{{ column.key }}</small>
                                </div>
                              </li>
                            </ul>
                          </li>
                        </ul>
                      </li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
          </li>
        </ul>
      </nav>
    </template>

    <button
      v-else
      class="db-sidebar-expand"
      type="button"
      title="Expand"
      @click="$emit('updateSidebarCollapsed', false)"
    >
      <PanelLeftOpen />
    </button>
  </aside>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Database,
  Folder,
  FolderOpen,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Unplug,
  X,
  Zap
} from 'lucide-vue-next'
import {
  columnNodeId,
  databaseCatalogDisplayName,
  schemaObjectFolderKey,
  schemaObjectFolders,
  schemaRoutineNodeId,
  type SchemaObjectKind,
  type VisibleGroupNode
} from '@/services/database/databaseWorkspaceRuntime'
import type {
  DatabaseColumnInfo,
  DatabaseConnectionInfo,
  DatabaseEngineCode,
  DatabaseTableInfo
} from '@shared/contracts/database'
import type { ContextMenuPayload } from '@/services/database/databaseWorkspaceTypes'

const props = defineProps<{
  sidebarCollapsed: boolean
  keyword: string
  visibleGroupNodes: VisibleGroupNode[]
  selectedNodeId: string | null
  editingGroupId: string | null
  editingGroupName: string
  expandedGroups: string[]
  expandedConnections: string[]
  expandedCatalogs: string[]
  expandedSchemas: string[]
  expandedSchemaObjectFolders: string[]
  expandedTables: string[]
  connectionsByGroup: (groupId: string) => DatabaseConnectionInfo[]
  engineAccent: (code: DatabaseEngineCode) => string
}>()

const emit = defineEmits<{
  updateSidebarCollapsed: [value: boolean]
  updateKeyword: [value: string]
  clearSearch: []
  refreshConnected: []
  toggleAddMenu: [event: MouseEvent]
  selectNode: [id: string]
  openContextMenu: [event: MouseEvent, payload: ContextMenuPayload]
  toggleGroup: [id: string]
  updateEditingGroupName: [value: string]
  commitGroupRename: []
  cancelGroupRename: []
  toggleConnection: [id: string]
  toggleConnectionStatus: [id: string]
  toggleCatalog: [connectionId: string, catalogName: string]
  toggleSchema: [connectionId: string, catalogName: string, schemaName: string]
  toggleSchemaObjectFolder: [connectionId: string, catalogName: string, schemaName: string, kind: SchemaObjectKind]
  openTable: [connectionId: string, catalogName: string, table: DatabaseTableInfo, schemaName?: string]
  toggleTable: [tableId: string]
  selectColumnNode: [table: DatabaseTableInfo, column: DatabaseColumnInfo]
}>()

const searchInputRef = ref<HTMLInputElement | null>(null)
const addButtonRef = ref<HTMLButtonElement | null>(null)

function clearSearch() {
  emit('clearSearch')
  focusSearch()
}

function focusSearch() {
  void nextTick(() => searchInputRef.value?.focus())
}

function addButtonRect() {
  return addButtonRef.value?.getBoundingClientRect() ?? null
}

function selectAndToggleGroup(groupId: string) {
  emit('selectNode', groupId)
  emit('toggleGroup', groupId)
}

function selectAndToggleConnection(connectionId: string) {
  emit('selectNode', connectionId)
  emit('toggleConnection', connectionId)
}

function selectAndToggleCatalog(connectionId: string, catalogName: string) {
  emit('selectNode', `${connectionId}:${catalogName}`)
  emit('toggleCatalog', connectionId, catalogName)
}

function selectAndToggleSchema(connectionId: string, catalogName: string, schemaName: string) {
  emit('selectNode', `${connectionId}:${catalogName}:${schemaName}`)
  emit('toggleSchema', connectionId, catalogName, schemaName)
}

function selectAndToggleSchemaObjectFolder(
  connectionId: string,
  catalogName: string,
  schemaName: string,
  kind: SchemaObjectKind
) {
  emit('selectNode', schemaObjectFolderKey(connectionId, catalogName, schemaName, kind))
  emit('toggleSchemaObjectFolder', connectionId, catalogName, schemaName, kind)
}

function isCatalogExpanded(connectionId: string, catalogName: string) {
  return props.expandedCatalogs.includes(`${connectionId}:${catalogName}`)
}

function isFlattenedSqliteConnection(connection: DatabaseConnectionInfo) {
  return connection.dbType === 'sqlite' && connection.catalogs.length === 1
}

function isSchemaExpanded(connectionId: string, catalogName: string, schemaName: string) {
  return props.expandedSchemas.includes(`${connectionId}:${catalogName}:${schemaName}`)
}

function isSchemaObjectFolderExpanded(connectionId: string, catalogName: string, schemaName: string, kind: SchemaObjectKind) {
  return props.expandedSchemaObjectFolders.includes(schemaObjectFolderKey(connectionId, catalogName, schemaName, kind))
}

function isTableExpanded(tableId: string) {
  return props.expandedTables.includes(tableId)
}

defineExpose({ focusSearch, addButtonRect })
</script>
