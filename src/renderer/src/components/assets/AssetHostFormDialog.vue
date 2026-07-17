<template>
  <div
    v-if="visible"
    class="files-folder-modal-backdrop"
  >
    <section
      class="files-folder-modal workspace-host-modal asset-form-panel"
      :data-onboarding-id="onboardingId"
    >
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
        class="workspace-host-form files-folder-form asset-host-form-body"
        @submit.prevent="emit('submit')"
      >
          <label>
            <span>设备类型</span>
            <select
              :value="assetType"
              @change="emit('field-change', 'assetType', ($event.target as HTMLSelectElement).value)"
            >
              <option value="person">服务器</option>
              <option value="switch">交换机</option>
              <option value="organization">堡垒机</option>
            </select>
          </label>
          <label v-if="showBastionType">
            <span>堡垒机类型</span>
            <select
              :value="bastionType"
              @change="emit('field-change', 'bastionType', ($event.target as HTMLSelectElement).value)"
            >
              <option value="jumpserver">JumpServer</option>
              <option value="teleport">Teleport</option>
            </select>
          </label>
          <label v-if="showSwitchBrand">
            <span>交换机品牌</span>
            <select
              :value="switchBrand"
              @change="emit('field-change', 'switchBrand', ($event.target as HTMLSelectElement).value)"
            >
              <option value="cisco">Cisco</option>
              <option value="huawei">Huawei</option>
            </select>
          </label>
          <label>
            <span>主机名 *</span>
            <input
              :value="hostTitle"
              placeholder="请输入主机名"
              @input="emit('field-change', 'hostTitle', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>
            <span>地址 *</span>
            <input
              :value="host"
              placeholder="请输入 IP 或 Host"
              @input="emit('field-change', 'host', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>
            <span>认证方式</span>
            <select
              :value="authType"
              @change="emit('field-change', 'authType', ($event.target as HTMLSelectElement).value)"
            >
              <option value="password">密码</option>
              <option value="keyBased">密钥</option>
            </select>
          </label>
          <label>
            <span>用户名 *</span>
            <input
              :value="username"
              placeholder="请输入用户名"
              @input="emit('field-change', 'username', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label v-if="authType === 'password'">
            <span>密码</span>
            <div class="asset-secret-field">
              <input
                :value="password"
                :type="passwordVisible ? 'text' : 'password'"
                :placeholder="passwordPlaceholder"
                autocomplete="new-password"
                @input="emit('field-change', 'password', ($event.target as HTMLInputElement).value)"
              />
              <button
                type="button"
                class="asset-secret-toggle"
                :title="passwordVisible ? t('assets.hostForm.hidePassword') : t('assets.hostForm.showPassword')"
                @click="emit('toggle-password')"
              >
                <EyeOff v-if="passwordVisible" />
                <Eye v-else />
              </button>
            </div>
          </label>
          <label v-if="authType === 'keyBased'">
            <span class="workspace-field-heading">
              {{ keychainLabel }}
              <button
                type="button"
                @click="emit('create-keychain')"
              >
                新建密钥
              </button>
            </span>
            <select
              :value="keychainId"
              @change="emit('field-change', 'keychainId', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ emptyKeychainLabel }}</option>
              <option
                v-for="keychain in keychainOptions"
                :key="keychain.id"
                :value="keychain.id"
              >
                {{ keychain.name }}
              </option>
            </select>
          </label>
          <label v-if="showGroup">
            <span>分组</span>
            <input
              :value="group"
              :list="groupDatalistId"
              placeholder="请输入分组"
              @input="emit('field-change', 'group', ($event.target as HTMLInputElement).value)"
            />
            <datalist :id="groupDatalistId">
              <option
                v-for="groupOption in groupOptions"
                :key="groupOption.key"
                :value="groupOption.name"
              />
            </datalist>
          </label>
          <label>
            <span>端口 *</span>
            <input
              :value="port"
              :type="portInputType"
              inputmode="numeric"
              placeholder="22"
              @input="emit('field-change', 'port', portInputType === 'number' ? Number(($event.target as HTMLInputElement).value) : ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>
            <span class="workspace-field-heading">
              代理
              <button
                type="button"
                @click="emit('create-proxy')"
              >
                新增代理
              </button>
            </span>
            <select
              v-if="proxyOptions.length"
              :value="proxyName"
              :data-testid="proxyTestId"
              @change="emit('field-change', 'proxyName', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">不使用代理</option>
              <option
                v-for="proxy in proxyOptions"
                :key="proxy.name"
                :value="proxy.name"
              >
                {{ proxy.name }}
              </option>
            </select>
            <div
              v-else
              class="asset-proxy-empty workspace-host-inline-empty"
            >
              <small>暂无 SSH 代理配置</small>
              <button
                type="button"
                @click="emit('create-proxy')"
              >
                {{ emptyProxyActionLabel }}
              </button>
            </div>
          </label>
          <label>
            <span class="workspace-field-heading">
              {{ jumpHostLabel }}
              <button
                type="button"
                @click="emit('create-jump-host')"
              >
                新建跳板机
              </button>
            </span>
            <select
              v-if="jumpHostOptions.length || showEmptyJumpHostSelect"
              :value="jumpHostId"
              @change="emit('field-change', 'jumpHostId', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">不使用跳板机</option>
              <option
                v-for="jumpHost in jumpHostOptions"
                :key="jumpHost.id"
                :value="jumpHost.id"
              >
                {{ jumpHost.label || jumpHost.name }}
              </option>
            </select>
            <div
              v-else
              class="asset-proxy-empty workspace-host-inline-empty"
            >
              <small>暂无可用跳板机主机</small>
              <button
                type="button"
                @click="emit('create-jump-host')"
              >
                新建跳板机
              </button>
            </div>
          </label>
          <label
            v-if="showComment"
            class="workspace-host-form-wide"
          >
            <span>备注</span>
            <textarea
              :value="comment"
              rows="3"
              placeholder="请输入备注"
              @input="emit('field-change', 'comment', ($event.target as HTMLTextAreaElement).value)"
            />
          </label>
          <p
            v-if="error"
            class="files-folder-error workspace-host-form-wide"
          >
            {{ error }}
          </p>
          <p
            v-if="testMessage"
            class="files-folder-error workspace-host-form-wide asset-connection-test-result"
            :class="{ success: testOk }"
          >
            {{ testMessage }}
          </p>
          <footer
            class="workspace-host-form-wide"
          >
            <button
              type="button"
              :data-testid="testConnectionTestId"
              :disabled="testLoading"
              @click="emit('test-connection')"
            >
              {{ testLoading ? '测试中' : '测试连接' }}
            </button>
            <button
              type="button"
              @click="emit('close')"
            >
              取消
            </button>
            <button
              type="button"
              class="primary"
              :data-onboarding-id="submitOnboardingId"
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
import { Eye, EyeOff, X } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import type { AiopsAssetAuthType, AiopsAssetType } from '@shared/contracts/assets'

export type AssetHostFormOption = { id: string; name: string; label?: string }
export type AssetHostFormGroupOption = { key: string; name: string }
export type AssetHostFormField =
  | 'assetType'
  | 'hostTitle'
  | 'host'
  | 'authType'
  | 'username'
  | 'password'
  | 'port'
  | 'keychainId'
  | 'proxyName'
  | 'jumpHostId'
  | 'group'
  | 'comment'
  | 'bastionType'
  | 'switchBrand'

const { t } = useI18n()

withDefaults(
  defineProps<{
    visible: boolean
    title: string
    assetType: AiopsAssetType
    hostTitle: string
    host: string
    authType: AiopsAssetAuthType
    username: string
    password: string
    passwordVisible: boolean
    port: string | number
    keychainId: string
    proxyName: string
    jumpHostId: string
    group?: string
    comment?: string
    bastionType?: string
    switchBrand?: string
    error?: string
    testLoading?: boolean
    testMessage?: string
    testOk?: boolean
    keychainOptions?: AssetHostFormOption[]
    groupOptions?: AssetHostFormGroupOption[]
    proxyOptions?: AssetHostFormOption[]
    jumpHostOptions?: AssetHostFormOption[]
    showBastionType?: boolean
    showSwitchBrand?: boolean
    showGroup?: boolean
    showComment?: boolean
    showEmptyJumpHostSelect?: boolean
    groupDatalistId?: string
    keychainLabel?: string
    emptyKeychainLabel?: string
    emptyProxyActionLabel?: string
    jumpHostLabel?: string
    passwordPlaceholder?: string
    portInputType?: 'text' | 'number'
    testConnectionTestId?: string
    proxyTestId?: string
    onboardingId?: string
    submitOnboardingId?: string
  }>(),
  {
    group: '',
    comment: '',
    bastionType: 'jumpserver',
    switchBrand: 'cisco',
    error: '',
    testLoading: false,
    testMessage: '',
    testOk: false,
    keychainOptions: () => [],
    groupOptions: () => [],
    proxyOptions: () => [],
    jumpHostOptions: () => [],
    showBastionType: false,
    showSwitchBrand: false,
    showGroup: false,
    showComment: false,
    showEmptyJumpHostSelect: false,
    groupDatalistId: 'asset-host-group-options',
    keychainLabel: 'KeyChain',
    emptyKeychainLabel: '不使用 KeyChain',
    emptyProxyActionLabel: '添加代理',
    jumpHostLabel: '登录跳板机',
    passwordPlaceholder: '',
    portInputType: 'text',
    testConnectionTestId: undefined,
    proxyTestId: undefined,
    onboardingId: undefined,
    submitOnboardingId: undefined
  }
)

const emit = defineEmits<{
  close: []
  submit: []
  'test-connection': []
  'toggle-password': []
  'create-keychain': []
  'create-proxy': []
  'create-jump-host': []
  'field-change': [field: AssetHostFormField, value: string | number]
}>()
</script>
