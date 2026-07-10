<template>
  <div
    v-if="visible"
    class="files-folder-modal-backdrop"
  >
    <section class="files-folder-modal workspace-folder-modal asset-folder-modal">
        <header>
          <h3>{{ title }}</h3>
          <button
            type="button"
            title="关闭"
            @click="emit('close')"
          >
            <X />
          </button>
        </header>
        <form
          class="files-folder-form"
          @submit.prevent="emit('submit')"
        >
          <label>
            <span>{{ nameLabel }}</span>
            <input
              :value="name"
              :placeholder="namePlaceholder"
              @input="emit('update:name', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>
            <span>{{ descriptionLabel }}</span>
            <textarea
              :value="description"
              rows="3"
              :placeholder="descriptionPlaceholder"
              @input="emit('update:description', ($event.target as HTMLTextAreaElement).value)"
            />
          </label>
          <p
            v-if="error"
            class="files-folder-error"
          >
            {{ error }}
          </p>
          <footer>
            <button
              type="button"
              @click="emit('close')"
            >
              取消
            </button>
            <button
              type="button"
              class="primary"
              @click="emit('submit')"
            >
              确定
            </button>
          </footer>
        </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    visible: boolean
    title: string
    name: string
    description: string
    error?: string
    nameLabel?: string
    descriptionLabel?: string
    namePlaceholder?: string
    descriptionPlaceholder?: string
  }>(),
  {
    error: '',
    nameLabel: '文件夹名称 *',
    descriptionLabel: '文件夹描述',
    namePlaceholder: '请输入文件夹名称',
    descriptionPlaceholder: '请输入文件夹描述'
  }
)

const emit = defineEmits<{
  close: []
  submit: []
  'update:name': [value: string]
  'update:description': [value: string]
}>()
</script>
