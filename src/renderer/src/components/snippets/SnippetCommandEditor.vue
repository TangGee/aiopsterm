<template>
  <div class="snippet-edit-panel">
    <h3>{{ isEditMode ? '编辑快捷命令' : '新建快捷命令' }}</h3>
    <input
      :value="form.name"
      placeholder="脚本名称"
      @input="$emit('update:name', ($event.target as HTMLInputElement).value)"
    />
    <select
      :value="form.groupUuid"
      @change="$emit('update:group-uuid', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">无命令组</option>
      <option
        v-for="group in groups"
        :key="group.uuid"
        :value="group.uuid"
      >
        {{ group.group_name }}
      </option>
    </select>

    <div class="script-editor-container">
      <div class="line-numbers">
        <span
          v-for="line in scriptLineCount"
          :key="line"
        >
          {{ line }}
        </span>
      </div>
      <textarea
        ref="scriptTextarea"
        :value="form.content"
        placeholder="请输入脚本内容..."
        @input="$emit('update:content', ($event.target as HTMLTextAreaElement).value)"
        @scroll="$emit('scroll-script')"
      ></textarea>
    </div>

    <div class="script-help">
      <button
        class="help-header"
        @click="$emit('toggle-help')"
      >
        <span>脚本语法说明</span>
        <ChevronDown :class="{ rotated: !showHelp }" />
      </button>
      <div
        v-if="showHelp"
        class="help-content"
      >
        <div>
          <strong>基本命令：</strong>
          <span>每行一个命令，按顺序执行</span>
        </div>
        <div>
          <strong>延时命令：</strong>
          <code>sleep==3000</code>
        </div>
        <div>
          <strong>特殊按键：</strong>
          <code>esc</code>
          <code>tab</code>
          <code>return</code>
          <code>backspace</code>
        </div>
        <div>
          <strong>方向键：</strong>
          <code>up</code>
          <code>down</code>
          <code>left</code>
          <code>right</code>
        </div>
        <div>
          <strong>Ctrl组合键：</strong>
          <code>ctrl+c</code>
          <code>ctrl+d</code>
          <code>ctrl+z</code>
        </div>
        <div class="example-header">
          <strong>示例脚本：</strong>
          <button
            type="button"
            class="copy-example"
            @click="$emit('copy-example')"
          >
            {{ copyExampleSuccess ? '已复制' : '复制' }}
          </button>
        </div>
        <pre>{{ exampleScript }}</pre>
      </div>
    </div>

    <p
      v-if="error"
      class="command-form-error"
    >
      {{ error }}
    </p>

    <footer>
      <button
        :disabled="saving"
        @click="$emit('cancel')"
      >
        取消
      </button>
      <button
        :disabled="saving"
        @click="$emit('save')"
      >
        {{ saving ? '保存中' : '确定' }}
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import type { SnippetsCommandForm } from '@/services/quick-commands/snippetsPanelTypes'
import type { SnippetGroup } from '@/services/quick-commands/quickCommandsRuntime'

defineProps<{
  isEditMode: boolean
  form: SnippetsCommandForm
  groups: SnippetGroup[]
  scriptLineCount: number
  showHelp: boolean
  copyExampleSuccess: boolean
  exampleScript: string
  error: string
  saving: boolean
}>()

defineEmits<{
  'update:name': [value: string]
  'update:content': [value: string]
  'update:group-uuid': [value: string]
  'scroll-script': []
  'toggle-help': []
  'copy-example': []
  cancel: []
  save: []
}>()

const scriptTextarea = ref<HTMLTextAreaElement | null>(null)

defineExpose({
  scriptTextarea
})
</script>
