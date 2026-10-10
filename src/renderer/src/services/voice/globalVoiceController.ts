import { shallowRef, type Ref } from 'vue'

type Controller = {
  state: Ref<'idle' | 'starting' | 'recording' | 'transcribing'>
  toggle: () => void
}
const controller = shallowRef<Controller | null>(null)
export const globalVoiceController = () => controller.value
export const registerGlobalVoiceController = (value: Controller) => {
  controller.value = value
  return () => { if (controller.value === value) controller.value = null }
}
