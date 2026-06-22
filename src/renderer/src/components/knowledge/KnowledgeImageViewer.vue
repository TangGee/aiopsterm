<template>
  <div
    class="kb-editor-image"
    @wheel.prevent="handleWheel"
  >
    <div
      v-if="imageDataUrl"
      class="kb-editor-image-stage"
      :class="{ draggable: imageScale > 1, dragging: imageDragging }"
      :style="imageStageStyle"
      @mousedown="startDrag"
      @mousemove="moveDrag"
      @mouseup="stopDrag"
      @mouseleave="stopDrag"
    >
      <img
        :src="imageDataUrl"
        :alt="relPath"
        draggable="false"
      />
    </div>
    <span v-else>图片无法预览</span>
    <div
      v-if="imageDataUrl"
      class="kb-editor-image-controls"
    >
      <button
        title="缩小"
        @click="zoomOut"
      >
        <ZoomOut />
      </button>
      <b>{{ Math.round(imageScale * 100) }}%</b>
      <button
        title="放大"
        @click="zoomIn"
      >
        <ZoomIn />
      </button>
      <button
        title="重置"
        @click="resetZoom"
      >
        <Maximize2 />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-vue-next'

defineProps<{
  imageDataUrl: string
  relPath: string
}>()

const minImageScale = 0.1
const maxImageScale = 10
const zoomStep = 0.25
const imageScale = ref(1)
const imageTranslateX = ref(0)
const imageTranslateY = ref(0)
const imageDragging = ref(false)
const imageDragStartX = ref(0)
const imageDragStartY = ref(0)

const imageStageStyle = computed(() => ({
  transform: `translate(${imageTranslateX.value}px, ${imageTranslateY.value}px) scale(${imageScale.value})`,
  cursor: imageScale.value > 1 ? (imageDragging.value ? 'grabbing' : 'grab') : 'default'
}))

const resetZoom = () => {
  imageScale.value = 1
  imageTranslateX.value = 0
  imageTranslateY.value = 0
  imageDragging.value = false
}

const zoomIn = () => {
  imageScale.value = Math.min(maxImageScale, imageScale.value + zoomStep)
}

const zoomOut = () => {
  imageScale.value = Math.max(minImageScale, imageScale.value - zoomStep)
  if (imageScale.value <= 1) {
    imageTranslateX.value = 0
    imageTranslateY.value = 0
  }
}

const handleWheel = (event: WheelEvent) => {
  if (event.deltaY > 0) zoomOut()
  else zoomIn()
}

const startDrag = (event: MouseEvent) => {
  if (imageScale.value <= 1) return
  imageDragging.value = true
  imageDragStartX.value = event.clientX - imageTranslateX.value
  imageDragStartY.value = event.clientY - imageTranslateY.value
}

const moveDrag = (event: MouseEvent) => {
  if (!imageDragging.value) return
  imageTranslateX.value = event.clientX - imageDragStartX.value
  imageTranslateY.value = event.clientY - imageDragStartY.value
}

const stopDrag = () => {
  imageDragging.value = false
}

defineExpose({
  resetZoom
})
</script>
