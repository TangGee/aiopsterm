<template>
  <aside
    class="side-rail"
    data-ui-focus-chrome
  >
    <nav class="rail-main">
      <template
        v-for="item in mainItems"
        :key="item.key"
      >
        <button
          class="rail-button"
          :class="{ active: workspace.mode === 'terminal' && workspace.activeModule === item.key }"
          :data-module-key="item.key"
          :data-onboarding-id="
            item.key === 'assets'
              ? 'assets-entry'
              : item.key === 'workspace'
                ? 'left-module-switcher'
                : undefined
          "
          :title="t(item.labelKey)"
          @click="openModule(item.key)"
        >
          <component :is="item.icon" />
        </button>
        <button
          v-if="item.key === 'aiSessions'"
          class="rail-button"
          :class="{ active: workspace.mode === 'agents' }"
          :title="t('module.agents')"
          data-testid="agents-mode-entry"
          @click="openAgentsMode"
        >
          <MonitorCog />
        </button>
      </template>
    </nav>
    <nav class="rail-bottom">
      <template
        v-for="item in bottomItems"
        :key="item.key"
      >
        <button
          v-if="item.key === 'user' && !workspace.userProfile.skippedLogin"
          class="rail-button user-rail-trigger"
          :class="{
            active: workspace.mode === 'terminal' && workspace.activeModule === item.key,
            'has-avatar': !workspace.userProfile.skippedLogin
          }"
          :data-module-key="item.key"
          :title="t(item.labelKey)"
          @click.stop="toggleUserMenu"
        >
          <span
            v-if="!workspace.userProfile.skippedLogin"
            class="rail-avatar"
          >
            {{ workspace.userProfile.avatarInitials }}
          </span>
          <component
            :is="item.icon"
            v-else
          />
          <em v-if="isVipUser">VIP</em>
        </button>
        <button
          v-else-if="item.key !== 'user'"
          class="rail-button"
          :class="{ active: workspace.mode === 'terminal' && workspace.activeModule === item.key }"
          :data-module-key="item.key"
          :data-onboarding-id="item.key === 'settings' ? 'setting-entry' : undefined"
          :title="t(item.labelKey)"
          @click="openModule(item.key)"
        >
          <component :is="item.icon" />
        </button>
      </template>
    </nav>

    <Teleport to="body">
      <div
        v-if="userMenuOpen"
        class="user-menu-popover"
        @click.stop
      >
        <button
          v-if="workspace.userProfile.skippedLogin"
          @click="login"
        >
          <LogIn />
          <span>登录</span>
        </button>
        <template v-else>
          <button @click="accountCenter">
            <Gauge />
            <span>账号中心</span>
          </button>
          <button @click="openUserInfo">
            <User />
            <span>个人信息</span>
          </button>
          <button @click="logout">
            <LogOut />
            <span>退出登录</span>
          </button>
        </template>
      </div>
    </Teleport>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Gauge, LogIn, LogOut, MonitorCog, User } from 'lucide-vue-next'
import { menuItems, type ModuleKey } from '@/config/navigation'
import { useI18n } from '@/i18n'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const { t } = useI18n()
const mainItems = computed(() => menuItems.filter((item) => item.position === 'main'))
const bottomItems = computed(() => menuItems.filter((item) => item.position === 'bottom'))
const userMenuOpen = ref(false)
const isVipUser = computed(() => {
  const profile = workspace.userProfile
  if (profile.skippedLogin) return false
  if (profile.subscription !== 'pro' && profile.subscription !== 'ultra') return false
  return new Date(profile.subscriptionExpiresAt) > new Date()
})

const enterTerminalMode = async () => {
  if (workspace.mode === 'terminal') return true
  return workspace.toggleMode()
}

const openAgentsMode = async () => {
  userMenuOpen.value = false
  if (workspace.mode === 'agents') {
    if (!workspace.agentsLeftOpen) await workspace.toggleLeft()
    return
  }
  await workspace.toggleMode()
}

const openModule = async (key: ModuleKey) => {
  userMenuOpen.value = false
  if (!(await enterTerminalMode())) return
  workspace.setActiveModule(key)
}

const toggleUserMenu = async () => {
  if (!(await enterTerminalMode())) return
  userMenuOpen.value = !userMenuOpen.value
}

const login = () => {
  workspace.openUserLogin()
  userMenuOpen.value = false
}

const accountCenter = async () => {
  userMenuOpen.value = false
  await workspace.openAccountCenter({ activateUserModule: true })
}

const openUserInfo = () => {
  userMenuOpen.value = false
  workspace.setActiveModule('user')
}

const logout = () => {
  workspace.logoutUser()
  userMenuOpen.value = false
}

const closeUserMenu = () => {
  userMenuOpen.value = false
}

onMounted(() => document.addEventListener('click', closeUserMenu))
onUnmounted(() => document.removeEventListener('click', closeUserMenu))
</script>
