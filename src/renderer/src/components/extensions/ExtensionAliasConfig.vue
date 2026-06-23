<template>
  <div class="alias-config">
    <div class="alias-config-container">
      <header class="alias-config-toolbar">
        <label class="alias-search-input">
          <input
            v-model="workspace.aliasSearchQuery"
            placeholder="模糊搜索"
          />
          <Search />
        </label>
        <button
          class="workspace-button primary"
          @click="workspace.createAliasCommand"
        >
          <Plus />
          添加命令
        </button>
        <span class="alias-config-hint">Enter 保存编辑，取消会恢复原值。</span>
      </header>

      <table class="alias-config-table">
        <thead>
          <tr>
            <th>Alias</th>
            <th>Command</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="record in workspace.filteredAliasCommands"
            :key="record.id"
          >
            <td>
              <input
                :value="record.alias"
                :disabled="!record.edit"
                :class="{ 'editable-input': record.edit }"
                @input="workspace.updateAliasDraft(record.id, { alias: ($event.target as HTMLInputElement).value })"
              />
            </td>
            <td>
              <textarea
                :value="record.command"
                :disabled="!record.edit"
                :class="{ 'editable-input': record.edit }"
                spellcheck="false"
                rows="1"
                @input="workspace.updateAliasDraft(record.id, { command: ($event.target as HTMLTextAreaElement).value })"
              ></textarea>
            </td>
            <td>
              <div class="alias-row-actions">
                <template v-if="record.edit">
                  <button
                    title="保存"
                    @click="workspace.saveAliasCommand(record.id)"
                  >
                    <Check />
                  </button>
                  <button
                    title="取消"
                    @click="workspace.cancelAliasEdit(record.id)"
                  >
                    <SquareX />
                  </button>
                </template>
                <template v-else>
                  <button
                    title="编辑"
                    @click="workspace.startAliasEdit(record.id)"
                  >
                    <Pencil />
                  </button>
                  <button
                    class="danger"
                    title="删除"
                    @click="workspace.deleteAliasCommand(record.id)"
                  >
                    <X />
                  </button>
                </template>
              </div>
            </td>
          </tr>
          <tr v-if="workspace.filteredAliasCommands.length === 0">
            <td colspan="3">暂无数据</td>
          </tr>
        </tbody>
      </table>
      <div
        v-if="workspace.extensionNotice"
        class="alias-config-notice"
      >
        {{ workspace.extensionNotice }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Check,
  Pencil,
  Plus,
  Search,
  SquareX,
  X
} from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
</script>
