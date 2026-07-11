<template>
  <div
    v-if="open"
    class="db-modal-overlay"
  >
    <form
      class="db-connection-modal"
      @submit.prevent="emit('save')"
    >
      <button
        type="button"
        :title="t('database.common.close')"
        @click="emit('close')"
      >
        <X />
      </button>
      <header>
        <span
          class="db-engine-large"
          :style="{ background: engineAccent(connectionDraft.dbType) }"
        />
        <h2>{{ mode === 'edit' ? t('database.connection.editTitle') : engineName(connectionDraft.dbType) }}</h2>
      </header>
      <label>
        {{ t('database.field.name') }}
        <input
          v-model="connectionDraft.name"
          :class="{ error: connectionErrors.includes('name') }"
          required
        />
      </label>
      <label>
        {{ t('database.field.environment') }}
        <select v-model="connectionDraft.env">
          <option value="Development">{{ t('database.environment.development') }}</option>
          <option value="TEST">{{ t('database.environment.test') }}</option>
          <option value="Staging">{{ t('database.environment.staging') }}</option>
          <option value="Production">{{ t('database.environment.production') }}</option>
        </select>
      </label>
      <label>
        {{ t('database.field.group') }}
        <select v-model="connectionDraft.groupId">
          <option
            v-for="group in groups"
            :key="group.id"
            :value="group.id"
          >
            {{ group.name }}
          </option>
        </select>
      </label>
      <label v-if="connectionDraft.dbType === 'sqlite'">
        {{ t('database.field.filePath') }}
        <div class="db-connection-file">
          <input
            v-model="connectionDraft.filePath"
            :class="{ error: connectionErrors.includes('filePath') }"
            required
            @input="emit('markConnectionUrlAuto')"
          />
          <button
            type="button"
            @click="emit('pickSqliteFile')"
          >
            {{ t('database.common.select') }}
          </button>
        </div>
      </label>
      <label v-if="connectionDraft.dbType === 'sqlite'">
        {{ t('database.field.readonly') }}
        <span class="db-connection-check">
          <input
            v-model="connectionDraft.readonly"
            type="checkbox"
          />
          <span>{{ t('database.connection.readonlyDescription') }}</span>
        </span>
      </label>
      <template v-else>
        <label>
          {{ t('database.field.host') }}
          <input
            v-model="connectionDraft.host"
            :class="{ error: connectionErrors.includes('host') }"
            :required="connectionDraft.dbType !== 'oracle' || !connectionDraft.url.trim()"
            @input="emit('markConnectionUrlAuto')"
          />
        </label>
        <label>
          {{ t('database.field.port') }}
          <input
            v-model.number="connectionDraft.port"
            :class="{ error: connectionErrors.includes('port') }"
            min="1"
            max="65535"
            type="number"
            :required="connectionDraft.dbType !== 'oracle' || !connectionDraft.url.trim()"
            @input="emit('markConnectionUrlAuto')"
          />
        </label>
        <label>
          {{ t('database.field.authentication') }}
          <select v-model="connectionDraft.authentication">
            <option value="UserAndPassword">{{ t('database.connection.userAndPassword') }}</option>
          </select>
        </label>
        <label>
          {{ t('database.field.user') }}
          <input
            v-model="connectionDraft.user"
            :class="{ error: connectionErrors.includes('user') }"
            required
          />
        </label>
        <label>
          {{ t('database.field.password') }}
          <div class="db-connection-password">
            <input
              v-model="connectionDraft.password"
              :type="passwordVisible ? 'text' : 'password'"
              :placeholder="mode === 'edit' ? t('database.connection.keepPasswordPlaceholder') : ''"
              autocomplete="new-password"
            />
            <button
              type="button"
              :title="passwordVisible ? t('database.connection.hidePassword') : t('database.connection.showPassword')"
              @click="emit('update:passwordVisible', !passwordVisible)"
            >
              {{ passwordVisible ? t('database.connection.hide') : t('database.connection.show') }}
            </button>
          </div>
        </label>
        <label>
          {{ localizedCatalogFieldLabel }}
          <input
            v-model="connectionDraft.database"
            @input="emit('markConnectionUrlAuto')"
          />
        </label>
        <label>
          {{ t('database.field.sshProxy') }}
          <span class="db-connection-check">
            <input
              v-model="connectionDraft.needProxy"
              type="checkbox"
            />
            <span>{{ t('database.connection.proxyDescription') }}</span>
          </span>
        </label>
        <label v-if="connectionDraft.needProxy && databaseProxyAvailable">
          {{ t('database.field.proxy') }}
          <select
            v-model="connectionDraft.proxyName"
            :class="{ error: connectionErrors.includes('proxyName') }"
          >
            <option value="">{{ t('database.connection.selectProxy') }}</option>
            <option
              v-for="proxy in databaseSshProxyOptions"
              :key="proxy.name"
              :value="proxy.name"
            >
              {{ proxy.name }} · {{ proxy.type }} {{ proxy.host }}:{{ proxy.port }}
            </option>
          </select>
        </label>
        <p
          v-else-if="connectionDraft.needProxy"
          class="db-modal-hint"
        >
          {{ t('database.connection.proxyUnavailable') }}
          <button
            type="button"
            @click="emit('openSshProxyConfig')"
          >
            {{ t('database.connection.addProxy') }}
          </button>
        </p>
        <label v-if="isPostgresCompatibleDbType(connectionDraft.dbType)">
          {{ t('database.field.sslMode') }}
          <select v-model="connectionDraft.sslMode">
            <option value="">-</option>
            <option
              v-for="sslMode in postgresSslModeOptions"
              :key="sslMode"
              :value="sslMode"
            >
              {{ sslMode }}
            </option>
          </select>
        </label>
      </template>
      <label>
        {{ connectionDraft.dbType === 'oracle' ? t('database.field.connectString') : 'URL' }}
        <input
          :value="connectionUrl"
          :class="{ error: connectionErrors.includes('url') }"
          @input="emit('update:connectionUrl', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <p
        v-if="connectionFeedback"
        class="db-modal-feedback"
        :class="{ error: connectionFeedbackKind === 'error' }"
      >
        {{ connectionFeedback }}
      </p>
      <footer>
        <button
          type="button"
          :disabled="connectionTesting || connectionSaving"
          @click="emit('test')"
        >
          {{ connectionTesting ? t('database.connection.testing') : t('database.connection.test') }}
        </button>
        <span />
        <button
          type="button"
          :disabled="connectionTesting || connectionSaving"
          @click="emit('close')"
        >
          {{ t('database.common.cancel') }}
        </button>
        <button
          type="submit"
          :disabled="connectionTesting || connectionSaving"
        >
          {{ connectionSaving ? t('database.common.saving') : t('database.common.save') }}
        </button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import type { SshProxyConfig } from '@shared/contracts/appRuntime'
import type { DatabaseEngineCode, DatabaseGroupInfo } from '@shared/contracts/database'
import {
  databaseCatalogFieldLabel,
  isPostgresCompatibleDbType
} from '@/services/database/databaseWorkspaceRuntime'
import type { DatabaseConnectionDraft } from '@/services/database/databaseWorkspaceTypes'

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  connectionDraft: DatabaseConnectionDraft
  connectionErrors: string[]
  groups: DatabaseGroupInfo[]
  connectionUrl: string
  connectionFeedback: string
  connectionFeedbackKind: 'info' | 'error'
  connectionTesting: boolean
  connectionSaving: boolean
  passwordVisible: boolean
  databaseProxyAvailable: boolean
  databaseSshProxyOptions: SshProxyConfig[]
  postgresSslModeOptions: readonly string[]
  engineAccent: (code: DatabaseEngineCode) => string
  engineName: (code: DatabaseEngineCode) => string
}>()

const { t } = useI18n()
const localizedCatalogFieldLabel = computed(() => {
  const label = databaseCatalogFieldLabel(props.connectionDraft)
  if (label === 'Catalog') return t('database.field.catalog')
  if (label === 'Service') return t('database.field.service')
  return t('database.field.database')
})

const emit = defineEmits<{
  close: []
  save: []
  test: []
  pickSqliteFile: []
  markConnectionUrlAuto: []
  openSshProxyConfig: []
  'update:connectionUrl': [value: string]
  'update:passwordVisible': [value: boolean]
}>()
</script>
