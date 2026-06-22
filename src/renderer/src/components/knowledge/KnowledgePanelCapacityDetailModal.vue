<template>
  <div
    v-if="open"
    class="file-modal"
  >
    <div class="file-modal-card kb-capacity-detail-modal">
      <header>
        <strong>容量来源明细</strong>
        <button
          title="关闭"
          @click="emit('close')"
        >
          <X />
        </button>
      </header>
      <table>
        <thead>
          <tr>
            <th>服务项</th>
            <th>到期时间</th>
            <th>容量</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>个人免费版</td>
            <td>长期有效</td>
            <td>{{ formatCapacity(totalBytes) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="kb-capacity-total">总计: {{ formatCapacity(totalBytes) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineProps<{
  open: boolean
  totalBytes: number
}>()

const emit = defineEmits<{
  close: []
}>()

const formatCapacity = (bytes: number) => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${bytes} B`
}
</script>
