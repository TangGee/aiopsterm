<template>
  <div
    v-if="target"
    class="file-modal"
  >
    <div class="file-modal-card small permission-modal">
      <header>
        <strong>权限设置 - {{ target.name }}</strong>
        <button
          title="关闭"
          @click="$emit('close')"
        >
          <X />
        </button>
      </header>
      <div class="permission-grid">
        <label
          v-for="group in permissionGroups"
          :key="group.key"
        >
          <span>{{ group.label }}</span>
          <label
            v-for="option in permissionOptions"
            :key="`${group.key}-${option}`"
            class="permission-check"
          >
            <input
              :checked="permissions[group.key].includes(option)"
              type="checkbox"
              :value="option"
              @change="$emit('toggle-permission', group.key, option, ($event.target as HTMLInputElement).checked)"
            />
            {{ option }}
          </label>
        </label>
      </div>
      <label class="permission-code">
        <span>权限</span>
        <input
          :value="permissionCode"
          readonly
        />
      </label>
      <label class="permission-recursive">
        <input
          :checked="recursivePermission"
          type="checkbox"
          @change="$emit('update:recursive-permission', ($event.target as HTMLInputElement).checked)"
        />
        应用于子目录
      </label>
      <footer>
        <button @click="$emit('close')">取消</button>
        <button
          class="primary"
          @click="$emit('confirm')"
        >
          确认
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { FileBrowserEntry } from '@/services/filesRuntime'

type PermissionKey = 'owner' | 'group' | 'public'

defineProps<{
  target: FileBrowserEntry | null
  permissionGroups: Array<{ key: PermissionKey; label: string }>
  permissionOptions: string[]
  permissions: Record<PermissionKey, string[]>
  permissionCode: string
  recursivePermission: boolean
}>()

defineEmits<{
  close: []
  confirm: []
  'update:recursive-permission': [value: boolean]
  'toggle-permission': [key: PermissionKey, option: string, checked: boolean]
}>()
</script>
