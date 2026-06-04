<template>
  <div
    v-if="step"
    class="spotlight-root"
  >
    <template v-if="targetRect">
      <div
        v-for="mask in masks"
        :key="mask.key"
        class="spotlight-mask"
        :style="mask.style"
        @click="handleMaskClick"
      />
      <div
        class="spotlight-highlight"
        :style="highlightStyle"
      />
      <div
        v-for="(style, index) in secondaryHighlightStyles"
        :key="index"
        class="spotlight-highlight spotlight-highlight-secondary"
        :style="style"
      />
    </template>
    <div
      v-else
      class="spotlight-mask spotlight-mask-full"
    />

    <article
      v-if="showCard"
      class="spotlight-card"
      :class="{ fallback: !targetRect }"
      :style="cardStyle"
    >
      <button
        class="spotlight-close"
        title="退出引导"
        @click="workspace.stopOnboardingTour"
      >
        <X />
      </button>
      <h3>{{ step.title }}</h3>
      <p>{{ step.description }}</p>
      <small v-if="!targetRect">当前目标暂不可见，已显示兜底说明。</small>
      <footer>
        <span>{{ workspace.onboardingActiveStepIndex + 1 }} / {{ workspace.onboardingActiveSteps.length }}</span>
        <div>
          <button
            v-if="workspace.onboardingActiveStepIndex > 0"
            class="settings-button"
            @click="workspace.previousOnboardingStep"
          >
            上一步
          </button>
          <button
            v-if="showNextButton"
            class="settings-button primary"
            @click="workspace.nextOnboardingStep"
          >
            {{ isLastStep ? '完成' : '下一步' }}
          </button>
        </div>
      </footer>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { X } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const targetRect = ref<DOMRect | null>(null)
const secondaryRects = ref<DOMRect[]>([])
const margin = 8
const safeInset = 16
const cardGap = 12
const cardWidth = 320
const cardHeight = 190

const step = computed(() => workspace.onboardingActiveStep)
const isLastStep = computed(() => workspace.onboardingActiveStepIndex >= workspace.onboardingActiveSteps.length - 1)
const showCard = computed(() => Boolean(step.value && (!step.value.hideCard || !targetRect.value)))
const showNextButton = computed(() => Boolean(!step.value?.requiresTargetClick || step.value.allowNextWithoutTargetClick || !targetRect.value))

const createHighlightRect = (rect: DOMRect) => ({
  top: Math.max(0, rect.top - margin),
  left: Math.max(0, rect.left - margin),
  width: Math.min(window.innerWidth, rect.width + margin * 2),
  height: Math.min(window.innerHeight, rect.height + margin * 2)
})

const highlightRect = computed(() => (targetRect.value ? createHighlightRect(targetRect.value) : null))

const highlightStyle = computed<CSSProperties>(() => {
  const rect = highlightRect.value
  if (!rect) return {}
  return {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  }
})

const secondaryHighlightStyles = computed<CSSProperties[]>(() =>
  secondaryRects.value.map(createHighlightRect).map((rect) => ({
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  }))
)

const masks = computed(() => {
  const rect = highlightRect.value
  if (!rect) return []
  const bottomTop = rect.top + rect.height
  return [
    { key: 'top', style: { top: '0px', left: '0px', width: '100vw', height: `${rect.top}px` } },
    { key: 'left', style: { top: `${rect.top}px`, left: '0px', width: `${rect.left}px`, height: `${rect.height}px` } },
    {
      key: 'right',
      style: {
        top: `${rect.top}px`,
        left: `${rect.left + rect.width}px`,
        width: `${Math.max(0, window.innerWidth - rect.left - rect.width)}px`,
        height: `${rect.height}px`
      }
    },
    { key: 'bottom', style: { top: `${bottomTop}px`, left: '0px', width: '100vw', height: `${Math.max(0, window.innerHeight - bottomTop)}px` } }
  ]
})

const overlapArea = (position: { top: number; left: number }, rect: NonNullable<typeof highlightRect.value>) => {
  const xOverlap = Math.max(0, Math.min(position.left + cardWidth, rect.left + rect.width) - Math.max(position.left, rect.left))
  const yOverlap = Math.max(0, Math.min(position.top + cardHeight, rect.top + rect.height) - Math.max(position.top, rect.top))
  return xOverlap * yOverlap
}

const cardStyle = computed<CSSProperties>(() => {
  const rect = highlightRect.value
  if (!rect) {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }
  const maxLeft = Math.max(safeInset, window.innerWidth - cardWidth - safeInset)
  const maxTop = Math.max(safeInset, window.innerHeight - cardHeight - safeInset)
  const alignedTop = Math.min(Math.max(rect.top, safeInset), maxTop)
  const alignedLeft = Math.min(Math.max(rect.left, safeInset), maxLeft)
  const candidates = [
    window.innerWidth - rect.left - rect.width - cardGap - safeInset >= cardWidth ? { top: alignedTop, left: rect.left + rect.width + cardGap } : null,
    rect.left - cardGap - safeInset >= cardWidth ? { top: alignedTop, left: rect.left - cardWidth - cardGap } : null,
    window.innerHeight - rect.top - rect.height - cardGap - safeInset >= cardHeight ? { top: rect.top + rect.height + cardGap, left: alignedLeft } : null,
    rect.top - cardGap - safeInset >= cardHeight ? { top: rect.top - cardHeight - cardGap, left: alignedLeft } : null
  ].filter(Boolean) as Array<{ top: number; left: number }>
  const position =
    candidates[0] ||
    [
      { top: safeInset, left: safeInset },
      { top: safeInset, left: maxLeft },
      { top: maxTop, left: safeInset },
      { top: maxTop, left: maxLeft }
    ].sort((a, b) => overlapArea(a, rect) - overlapArea(b, rect))[0]

  return {
    top: `${position.top}px`,
    left: `${position.left}px`
  }
})

const getTarget = (targetId: string) => {
  const candidates = Array.from(document.querySelectorAll(`[data-onboarding-id="${targetId}"]`)) as HTMLElement[]
  return candidates.find((target) => {
    const rect = target.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) || null
}

const getAdvanceTargetIds = () => {
  const activeStep = step.value
  if (!activeStep) return []
  return activeStep.advanceOnTargetIds?.length ? activeStep.advanceOnTargetIds : [activeStep.targetId]
}

const handleTargetActivation = (event: MouseEvent) => {
  const activeStep = step.value
  if (!activeStep?.advanceOnTargetClick) return
  const clickedTarget = getAdvanceTargetIds().some((targetId) => getTarget(targetId)?.contains(event.target as Node))
  if (!clickedTarget) return
  window.setTimeout(() => {
    if (step.value?.id === activeStep.id) {
      workspace.nextOnboardingStep()
    }
  }, 80)
}

const refreshTarget = async () => {
  const activeStep = step.value
  if (!activeStep) {
    targetRect.value = null
    secondaryRects.value = []
    return
  }
  await nextTick()
  ;[60, 180, 420].forEach((delay) => {
    window.setTimeout(() => {
      if (step.value?.id !== activeStep.id) return
      const target = getTarget(activeStep.targetId)
      if (!target) {
        targetRect.value = null
        secondaryRects.value = []
        return
      }
      target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      const rect = target.getBoundingClientRect()
      targetRect.value = rect.width > 0 && rect.height > 0 ? rect : null
      secondaryRects.value = (activeStep.highlightTargetIds || [])
        .map(getTarget)
        .filter((item): item is HTMLElement => Boolean(item))
        .map((item) => item.getBoundingClientRect())
    }, delay)
  })
}

const handleMaskClick = (event: MouseEvent) => {
  const activeStep = step.value
  if (!activeStep?.advanceOnTargetClick) return
  const target = getAdvanceTargetIds()
    .map(getTarget)
    .find((item): item is HTMLElement => Boolean(item))
  if (!target) return
  const rect = target.getBoundingClientRect()
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
  if (!inside) return
  event.preventDefault()
  event.stopPropagation()
  target.click()
  window.setTimeout(() => {
    if (step.value?.id === activeStep.id) {
      workspace.nextOnboardingStep()
    }
  }, 80)
}

watch(
  () => [workspace.onboardingActiveTour, workspace.onboardingActiveStepIndex] as const,
  () => refreshTarget(),
  { immediate: true }
)

watch(
  () => workspace.onboardingAutoApprovalEvent,
  (eventCount) => {
    if (!eventCount || step.value?.advanceOnEvent !== 'onboarding:autoApprovalEnabled') return
    workspace.nextOnboardingStep()
  }
)

onMounted(() => {
  window.addEventListener('resize', refreshTarget)
  window.addEventListener('scroll', refreshTarget, true)
  window.addEventListener('mousedown', handleTargetActivation, true)
  window.addEventListener('click', handleTargetActivation, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', refreshTarget)
  window.removeEventListener('scroll', refreshTarget, true)
  window.removeEventListener('mousedown', handleTargetActivation, true)
  window.removeEventListener('click', handleTargetActivation, true)
})
</script>
