<template>
  <div
    v-if="addMenuOpen"
    class="db-popup-menu db-add-menu"
    :style="{ top: `${addMenuPosition.y}px`, left: `${addMenuPosition.x}px` }"
    @click.stop
  >
    <button
      type="button"
      @click="$emit('addGroup')"
    >
      New Group
    </button>
    <div class="db-popup-subtitle">New Connection</div>
    <button
      v-for="engine in databaseEngines"
      :key="engine.name"
      type="button"
      :title="`New ${engine.name} connection`"
      @click="$emit('openConnectionModalFromEngine', engine)"
    >
      <span
        class="db-engine-dot"
        :style="{ background: engine.accent }"
      />
      {{ engine.name }}
    </button>
  </div>

  <div
    v-if="contextMenu"
    class="db-popup-menu db-context-menu"
    :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
    @click.stop
  >
    <template v-if="contextMenu.type === 'group'">
      <div
        class="db-popup-submenu-wrap"
        @mouseenter="$emit('updateContextSubmenu', 'groupConnection')"
      >
        <button type="button">
          <span>New Connection</span>
          <span class="db-popup-arrow">›</span>
        </button>
        <div
          v-if="contextSubmenu === 'groupConnection'"
          class="db-popup-menu db-popup-submenu"
        >
          <button
            v-for="engine in databaseEngines"
            :key="`ctx-${engine.name}`"
            type="button"
            :title="`New ${engine.name} connection`"
            @click="$emit('openConnectionModalFromEngine', engine, contextMenu.groupId)"
          >
            <span
              class="db-engine-dot"
              :style="{ background: engine.accent }"
            />
            {{ engine.name }}
          </button>
        </div>
      </div>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('addGroup', contextMenu.groupId)"
      >
        New Group
      </button>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('startGroupRename', contextMenu.groupId)"
      >
        Rename
      </button>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('copyContextName')"
      >
        Copy Name
      </button>
      <div
        class="db-popup-submenu-wrap"
        @mouseenter="$emit('updateContextSubmenu', 'groupMove')"
      >
        <button type="button">
          <span>Move To</span>
          <span class="db-popup-arrow">›</span>
        </button>
        <div
          v-if="contextSubmenu === 'groupMove'"
          class="db-popup-menu db-popup-submenu"
        >
          <button
            type="button"
            :disabled="groupRootMoveDisabled"
            @click="$emit('moveGroupTo', contextMenu.groupId, null)"
          >
            Root Group
          </button>
          <button
            v-for="target in groupMoveTargets"
            :key="target.id"
            type="button"
            @click="$emit('moveGroupTo', contextMenu.groupId, target.id)"
          >
            {{ target.name }}
          </button>
          <button
            v-if="groupMoveTargets.length === 0 && groupRootMoveDisabled"
            type="button"
            disabled
          >
            Current Group
          </button>
        </div>
      </div>
      <div class="db-popup-divider" />
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('requestDeleteGroup', contextMenu.groupId)"
      >
        Delete Group
      </button>
    </template>
    <template v-else-if="contextMenu.type === 'connection'">
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('connectFromMenu', contextMenu.connectionId)"
      >
        {{ contextConnectionConnected ? 'Close Connection' : 'Open Connection' }}
      </button>
      <div class="db-popup-divider" />
      <button
        type="button"
        :disabled="!contextConnectionConnected"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="contextConnectionConnected && $emit('openSqlConsole', contextMenu.connectionId)"
      >
        Query Console
      </button>
      <button
        type="button"
        :disabled="!contextConnectionCanCreateDatabase"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="contextConnectionCanCreateDatabase && $emit('openCreateDatabaseModal', contextMenu.connectionId)"
      >
        Create Database
      </button>
      <div class="db-popup-divider" />
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('editConnection', contextMenu.connectionId)"
      >
        Editor Source
      </button>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('copyContextName')"
      >
        Copy Name
      </button>
      <div class="db-popup-divider" />
      <div
        class="db-popup-submenu-wrap"
        @mouseenter="$emit('updateContextSubmenu', 'connectionMove')"
      >
        <button type="button">
          <span>Move To</span>
          <span class="db-popup-arrow">›</span>
        </button>
        <div
          v-if="contextSubmenu === 'connectionMove'"
          class="db-popup-menu db-popup-submenu"
        >
          <button
            type="button"
            :disabled="connectionRootMoveDisabled"
            @click="$emit('moveConnectionToGroup', contextMenu.connectionId, defaultGroupId)"
          >
            Root Group
          </button>
          <button
            v-for="target in connectionMoveTargets"
            :key="target.id"
            type="button"
            @click="$emit('moveConnectionToGroup', contextMenu.connectionId, target.id)"
          >
            {{ target.name }}
          </button>
          <button
            v-if="connectionMoveTargets.length === 0 && connectionRootMoveDisabled"
            type="button"
            disabled
          >
            Current Group
          </button>
        </div>
      </div>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('refreshConnectionFromMenu', contextMenu.connectionId)"
      >
        Refresh
      </button>
      <div class="db-popup-divider" />
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('requestRemoveConnection', contextMenu.connectionId)"
      >
        Remove
      </button>
    </template>
    <template v-else>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('openContextTable')"
      >
        Open Table
      </button>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('openContextSql')"
      >
        Query Console
      </button>
      <div class="db-popup-divider" />
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('openDdlModalFromContext')"
      >
        View DDL
      </button>
      <div
        class="db-popup-submenu-wrap"
        @mouseenter="$emit('updateContextSubmenu', 'tableCopy')"
      >
        <button type="button">
          <span>Copy Table</span>
          <span class="db-popup-arrow">›</span>
        </button>
        <div
          v-if="contextSubmenu === 'tableCopy'"
          class="db-popup-menu db-popup-submenu"
        >
          <button
            type="button"
            @click="$emit('copyContextName')"
          >
            Copy Table Name
          </button>
          <button
            type="button"
            @click="$emit('copySelectSql')"
          >
            Copy Table SELECT
          </button>
          <button
            type="button"
            @click="$emit('copyTableDdlFromContext')"
          >
            Copy Table DDL
          </button>
        </div>
      </div>
      <div class="db-popup-divider" />
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('requestDangerousTableAction', 'truncate')"
      >
        Truncate
      </button>
      <button
        class="danger"
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('requestDangerousTableAction', 'drop')"
      >
        Drop
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { DatabaseEngineInfo } from '@shared/contracts/database'
import type { ContextMenu, ContextSubmenu } from '@/services/databaseWorkspaceTypes'

defineProps<{
  addMenuOpen: boolean
  addMenuPosition: { x: number; y: number }
  contextMenu: ContextMenu | null
  contextSubmenu: ContextSubmenu
  databaseEngines: DatabaseEngineInfo[]
  groupRootMoveDisabled: boolean
  groupMoveTargets: Array<{ id: string; name: string }>
  contextConnectionConnected: boolean
  contextConnectionCanCreateDatabase: boolean
  connectionRootMoveDisabled: boolean
  connectionMoveTargets: Array<{ id: string; name: string }>
  defaultGroupId: string
}>()

defineEmits<{
  addGroup: [parentGroupId?: string | null]
  openConnectionModalFromEngine: [engine: DatabaseEngineInfo, groupId?: string]
  updateContextSubmenu: [value: ContextSubmenu]
  closeContextSubmenuSoon: []
  startGroupRename: [groupId: string]
  copyContextName: []
  moveGroupTo: [groupId: string, parentId: string | null]
  requestDeleteGroup: [groupId: string]
  connectFromMenu: [connectionId: string]
  openSqlConsole: [connectionId: string]
  openCreateDatabaseModal: [connectionId: string]
  editConnection: [connectionId: string]
  moveConnectionToGroup: [connectionId: string, groupId: string]
  refreshConnectionFromMenu: [connectionId: string]
  requestRemoveConnection: [connectionId: string]
  openContextTable: []
  openContextSql: []
  openDdlModalFromContext: []
  copySelectSql: []
  copyTableDdlFromContext: []
  requestDangerousTableAction: [action: 'drop' | 'truncate']
}>()
</script>
