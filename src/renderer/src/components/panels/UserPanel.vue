<template>
  <section
    class="user-info-workspace"
    data-ui-focus-scope="user"
    data-ui-focus-primary
    tabindex="-1"
  >
    <header class="user-info-title">
      <h2>个人信息</h2>
      <button
        class="settings-tab-close"
        title="关闭"
        @click="workspace.setActiveModule('workspace')"
      >
        <X />
      </button>
    </header>

    <main class="user-info-body">
      <UserLoginCard
        v-if="workspace.userProfile.skippedLogin"
        :login-tab="workspace.userLoginTab"
        :login-draft="loginDraft"
        :login-loading="workspace.userLoginLoading"
        :login-code-countdown="workspace.userLoginCodeCountdown"
        :login-code-sending="workspace.userLoginCodeSending"
        :can-send-email-code="canSendLoginEmailCode"
        :can-send-mobile-code="canSendLoginMobileCode"
        :need-device-verification="workspace.userProfile.needDeviceVerification"
        @update:login-tab="workspace.setUserLoginTab"
        @update:login-draft="updateLoginDraft"
        @send-code="sendLoginCode"
        @login-account="loginWithAccount"
        @login-email="loginWithEmail"
        @login-mobile="loginWithMobile"
        @skip-login="skipLogin"
      />

      <UserProfileCard
        v-else
        :profile="workspace.userProfile"
        :profile-draft="profileDraft"
        :editing="editing"
        :is-subscription-active="isSubscriptionActive"
        :can-reset-password="workspace.canResetUserPassword"
        :can-edit-mobile="workspace.canEditUserMobile"
        :can-edit-email="workspace.canEditUserEmail"
        @update:profile-draft="updateProfileDraft"
        @start-editing="startEditing"
        @cancel-editing="cancelEditing"
        @save-profile="saveProfile"
        @open-password="openPasswordModal"
        @open-contact="openContactModal"
        @open-avatar="openAvatarModal"
        @open-account-center="workspace.openAccountCenter"
        @logout="workspace.logoutUser"
      />
    </main>

    <div
      v-if="workspace.userNotice"
      class="user-info-notice"
    >
      {{ workspace.userNotice }}
    </div>

    <UserPasswordModal
      v-if="passwordModalOpen"
      v-model:password="passwordDraft"
      v-model:confirm-password="confirmPasswordDraft"
      @cancel="cancelPasswordModal"
      @save="savePassword"
    />

    <UserContactModal
      v-if="contactModalOpen"
      v-model:contact="contactDraft"
      v-model:code="contactCodeDraft"
      :kind="contactKind"
      :countdown="workspace.userContactCodeCountdown[contactKind]"
      :sending="workspace.userContactCodeSending[contactKind]"
      :can-send-code="canSendContactCode"
      @send-code="sendContactCode"
      @cancel="cancelContactModal"
      @save="saveContact"
    />

    <UserAvatarModal
      v-if="avatarModalOpen"
      v-model:avatar-zoom="avatarZoom"
      :avatar-preview="avatarPreview"
      :avatar-prepared-image-url="avatarPreparedImageUrl"
      :avatar-cleared="avatarCleared"
      :avatar-offset="avatarOffset"
      @choose-avatar="chooseAvatarImage"
      @clear-avatar="clearAvatarImage"
      @start-drag="startAvatarDrag"
      @cancel="cancelAvatarModal"
      @save="saveAvatar"
    />

    <UserAccountCenterModal
      v-if="workspace.userAccountCenterOpen"
      :profile="workspace.userProfile"
      :trusted-devices="workspace.trustedDevices"
      :billing-settings="workspace.billingSettings"
      :is-subscription-active="isSubscriptionActive"
      :can-reset-password="workspace.canResetUserPassword"
      @close="workspace.closeAccountCenter"
      @revoke-device="workspace.openTrustedDeviceRevoke"
      @open-billing-settings="openSettingsSection('billing')"
      @open-trusted-devices="openSettingsSection('trustedDevices')"
    />

    <UserTrustedDeviceRevokeModal
      v-if="workspace.trustedDeviceModal.open"
      @cancel="closeTrustedDeviceModal"
      @confirm="workspace.confirmTrustedDeviceRevoke"
    />
  </section>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import UserAccountCenterModal from '@/components/user/UserAccountCenterModal.vue'
import UserAvatarModal from '@/components/user/UserAvatarModal.vue'
import UserContactModal from '@/components/user/UserContactModal.vue'
import UserLoginCard from '@/components/user/UserLoginCard.vue'
import UserPasswordModal from '@/components/user/UserPasswordModal.vue'
import UserProfileCard from '@/components/user/UserProfileCard.vue'
import UserTrustedDeviceRevokeModal from '@/components/user/UserTrustedDeviceRevokeModal.vue'
import { useUserPanelRuntime } from '@/services/user/userPanelRuntime'

const {
  workspace,
  editing,
  passwordModalOpen,
  contactModalOpen,
  avatarModalOpen,
  contactKind,
  passwordDraft,
  confirmPasswordDraft,
  contactDraft,
  contactCodeDraft,
  avatarPreview,
  avatarPreparedImageUrl,
  avatarCleared,
  avatarZoom,
  avatarOffset,
  loginDraft,
  profileDraft,
  isSubscriptionActive,
  canSendContactCode,
  canSendLoginEmailCode,
  canSendLoginMobileCode,
  updateLoginDraft,
  updateProfileDraft,
  sendLoginCode,
  loginWithAccount,
  loginWithEmail,
  loginWithMobile,
  skipLogin,
  startEditing,
  cancelEditing,
  saveProfile,
  openPasswordModal,
  cancelPasswordModal,
  savePassword,
  openContactModal,
  cancelContactModal,
  sendContactCode,
  saveContact,
  openAvatarModal,
  chooseAvatarImage,
  clearAvatarImage,
  startAvatarDrag,
  cancelAvatarModal,
  saveAvatar,
  closeTrustedDeviceModal,
  openSettingsSection
} = useUserPanelRuntime()
</script>
