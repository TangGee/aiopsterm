<template>
  <aside class="side-rail">
    <nav class="rail-main">
      <button
        v-for="item in mainItems"
        :key="item.key"
        class="rail-button"
        :class="{ active: workspace.activeModule === item.key }"
        :data-onboarding-id="
          item.key === 'assets'
            ? 'assets-entry'
            : item.key === 'workspace'
              ? 'left-module-switcher'
              : undefined
        "
        :title="item.label"
        @click="workspace.setActiveModule(item.key)"
      >
        <component :is="item.icon" />
      </button>
    </nav>
    <nav class="rail-bottom">
      <template
        v-for="item in bottomItems"
        :key="item.key"
      >
        <button
          v-if="item.key === 'user'"
          class="rail-button user-rail-trigger"
          :class="{ active: workspace.activeModule === item.key, 'has-avatar': !workspace.userProfile.skippedLogin }"
          :title="item.label"
          @click.stop="userMenuOpen = !userMenuOpen"
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
          v-else
          class="rail-button"
          :class="{ active: workspace.activeModule === item.key }"
          :data-onboarding-id="item.key === 'settings' ? 'setting-entry' : undefined"
          :title="item.label"
          @click="openModule(item.key)"
        >
          <component :is="item.icon" />
        </button>
      </template>
    </nav>

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
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Gauge, LogIn, LogOut, User } from 'lucide-vue-next'
import { menuItems, type ModuleKey } from '@/data/mockData'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const mainItems = computed(() => menuItems.filter((item) => item.position === 'main'))
const bottomItems = computed(() => menuItems.filter((item) => item.position === 'bottom'))
const userMenuOpen = ref(false)
const isVipUser = computed(() => {
  const profile = workspace.userProfile
  if (profile.skippedLogin) return false
  if (profile.subscription !== 'pro' && profile.subscription !== 'ultra') return false
  return new Date(profile.subscriptionExpiresAt) > new Date()
})

const openModule = (key: ModuleKey) => {
  userMenuOpen.value = false
  workspace.setActiveModule(key)
}

const login = () => {
  workspace.openUserLogin()
  userMenuOpen.value = false
}

const accountCenter = () => {
  workspace.openAccountCenter()
  userMenuOpen.value = false
  workspace.setActiveModule('user')
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
