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
      {{ t('database.menu.newGroup') }}
    </button>
    <div class="db-popup-subtitle">{{ t('database.menu.newConnection') }}</div>
    <button
      v-for="engine in databaseEngines"
      :key="engine.name"
      type="button"
      :title="t('database.overview.newEngineConnection', { name: engine.name })"
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
          <span>{{ t('database.menu.newConnection') }}</span>
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
            :title="t('database.overview.newEngineConnection', { name: engine.name })"
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
        {{ t('database.menu.newGroup') }}
      </button>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('startGroupRename', contextMenu.groupId)"
      >
        {{ t('database.common.rename') }}
      </button>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('copyContextName')"
      >
        {{ t('database.menu.copyName') }}
      </button>
      <div
        class="db-popup-submenu-wrap"
        @mouseenter="$emit('updateContextSubmenu', 'groupMove')"
      >
        <button type="button">
          <span>{{ t('database.menu.moveTo') }}</span>
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
            {{ t('database.menu.rootGroup') }}
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
            {{ t('database.menu.currentGroup') }}
          </button>
        </div>
      </div>
      <div class="db-popup-divider" />
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('requestDeleteGroup', contextMenu.groupId)"
      >
        {{ t('database.menu.deleteGroup') }}
      </button>
    </template>
    <template v-else-if="contextMenu.type === 'connection'">
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('connectFromMenu', contextMenu.connectionId)"
      >
        {{ contextConnectionConnected ? t('database.connection.close') : t('database.connection.open') }}
      </button>
      <div class="db-popup-divider" />
      <button
        type="button"
        :disabled="!contextConnectionConnected"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="contextConnectionConnected && $emit('openSqlConsole', contextMenu.connectionId)"
      >
        {{ t('database.menu.queryConsole') }}
      </button>
      <button
        type="button"
        :disabled="!contextConnectionCanCreateDatabase"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="contextConnectionCanCreateDatabase && $emit('openCreateDatabaseModal', contextMenu.connectionId)"
      >
        {{ t('database.menu.createDatabase') }}
      </button>
      <div class="db-popup-divider" />
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('editConnection', contextMenu.connectionId)"
      >
        {{ t('database.menu.editSource') }}
      </button>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('copyContextName')"
      >
        {{ t('database.menu.copyName') }}
      </button>
      <div class="db-popup-divider" />
      <div
        class="db-popup-submenu-wrap"
        @mouseenter="$emit('updateContextSubmenu', 'connectionMove')"
      >
        <button type="button">
          <span>{{ t('database.menu.moveTo') }}</span>
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
            {{ t('database.menu.rootGroup') }}
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
            {{ t('database.menu.currentGroup') }}
          </button>
        </div>
      </div>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('refreshConnectionFromMenu', contextMenu.connectionId)"
      >
        {{ t('database.common.refresh') }}
      </button>
      <div class="db-popup-divider" />
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('requestRemoveConnection', contextMenu.connectionId)"
      >
        {{ t('database.common.remove') }}
      </button>
    </template>
    <template v-else>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('openContextTable')"
      >
        {{ t('database.menu.openTable') }}
      </button>
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('openContextSql')"
      >
        {{ t('database.menu.queryConsole') }}
      </button>
      <div class="db-popup-divider" />
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('openDdlModalFromContext')"
      >
        {{ t('database.menu.viewDdl') }}
      </button>
      <div
        class="db-popup-submenu-wrap"
        @mouseenter="$emit('updateContextSubmenu', 'tableCopy')"
      >
        <button type="button">
          <span>{{ t('database.menu.copyTable') }}</span>
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
            {{ t('database.menu.copyTableName') }}
          </button>
          <button
            type="button"
            @click="$emit('copySelectSql')"
          >
            {{ t('database.menu.copyTableSelect') }}
          </button>
          <button
            type="button"
            @click="$emit('copyTableDdlFromContext')"
          >
            {{ t('database.menu.copyTableDdl') }}
          </button>
        </div>
      </div>
      <div class="db-popup-divider" />
      <button
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('requestDangerousTableAction', 'truncate')"
      >
        {{ t('database.menu.truncate') }}
      </button>
      <button
        class="danger"
        type="button"
        @mouseenter="$emit('closeContextSubmenuSoon')"
        @click="$emit('requestDangerousTableAction', 'drop')"
      >
        {{ t('database.menu.drop') }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '@/i18n'
import type { DatabaseEngineInfo } from '@shared/contracts/database'
import type { ContextMenu, ContextSubmenu } from '@/services/database/databaseWorkspaceTypes'

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

const { t } = useI18n()

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
