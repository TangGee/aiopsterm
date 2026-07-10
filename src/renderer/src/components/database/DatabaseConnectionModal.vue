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
        title="Close"
        @click="emit('close')"
      >
        <X />
      </button>
      <header>
        <span
          class="db-engine-large"
          :style="{ background: engineAccent(connectionDraft.dbType) }"
        />
        <h2>{{ mode === 'edit' ? 'Edit Connection' : engineName(connectionDraft.dbType) }}</h2>
      </header>
      <label>
        Name
        <input
          v-model="connectionDraft.name"
          :class="{ error: connectionErrors.includes('name') }"
          required
        />
      </label>
      <label>
        Env
        <select v-model="connectionDraft.env">
          <option>Development</option>
          <option>TEST</option>
          <option>Staging</option>
          <option>Production</option>
        </select>
      </label>
      <label>
        Group
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
        File Path
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
            Select
          </button>
        </div>
      </label>
      <label v-if="connectionDraft.dbType === 'sqlite'">
        Readonly
        <span class="db-connection-check">
          <input
            v-model="connectionDraft.readonly"
            type="checkbox"
          />
          <span>Open database in readonly mode</span>
        </span>
      </label>
      <template v-else>
        <label>
          Host
          <input
            v-model="connectionDraft.host"
            :class="{ error: connectionErrors.includes('host') }"
            :required="connectionDraft.dbType !== 'oracle' || !connectionDraft.url.trim()"
            @input="emit('markConnectionUrlAuto')"
          />
        </label>
        <label>
          Port
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
          Authentication
          <select v-model="connectionDraft.authentication">
            <option>UserAndPassword</option>
          </select>
        </label>
        <label>
          User
          <input
            v-model="connectionDraft.user"
            :class="{ error: connectionErrors.includes('user') }"
            required
          />
        </label>
        <label>
          Password
          <div class="db-connection-password">
            <input
              v-model="connectionDraft.password"
              :type="passwordVisible ? 'text' : 'password'"
              :placeholder="mode === 'edit' ? 'Leave empty to keep saved password' : ''"
              autocomplete="new-password"
            />
            <button
              type="button"
              :title="passwordVisible ? 'Hide password' : 'Show password'"
              @click="emit('update:passwordVisible', !passwordVisible)"
            >
              {{ passwordVisible ? 'Hide' : 'Show' }}
            </button>
          </div>
        </label>
        <label>
          {{ databaseCatalogFieldLabel(connectionDraft) }}
          <input
            v-model="connectionDraft.database"
            @input="emit('markConnectionUrlAuto')"
          />
        </label>
        <label>
          SSH Proxy
          <span class="db-connection-check">
            <input
              v-model="connectionDraft.needProxy"
              type="checkbox"
            />
            <span>Route database traffic through a configured proxy</span>
          </span>
        </label>
        <label v-if="connectionDraft.needProxy && databaseProxyAvailable">
          Proxy
          <select
            v-model="connectionDraft.proxyName"
            :class="{ error: connectionErrors.includes('proxyName') }"
          >
            <option value="">Select proxy</option>
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
          No SSH proxy config is available.
          <button
            type="button"
            @click="emit('openSshProxyConfig')"
          >
            Add Proxy
          </button>
        </p>
        <label v-if="isPostgresCompatibleDbType(connectionDraft.dbType)">
          SSL Mode
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
        {{ connectionDraft.dbType === 'oracle' ? 'Connect String' : 'URL' }}
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
          {{ connectionTesting ? 'Testing...' : 'Test Connection' }}
        </button>
        <span />
        <button
          type="button"
          :disabled="connectionTesting || connectionSaving"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          type="submit"
          :disabled="connectionTesting || connectionSaving"
        >
          {{ connectionSaving ? 'Saving...' : 'Save' }}
        </button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { SshProxyConfig } from '@shared/contracts/appRuntime'
import type { DatabaseEngineCode, DatabaseGroupInfo } from '@shared/contracts/database'
import {
  databaseCatalogFieldLabel,
  isPostgresCompatibleDbType
} from '@/services/database/databaseWorkspaceRuntime'
import type { DatabaseConnectionDraft } from '@/services/database/databaseWorkspaceTypes'

defineProps<{
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
