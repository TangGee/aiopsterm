import { ref, watch, type Ref } from 'vue'

export function useKubernetesOutputScroll(
  element: Ref<HTMLElement | null>,
  output: () => string,
  scope: () => string
) {
  const following = ref(true)

  const onScroll = () => {
    const root = element.value
    if (root) following.value = root.scrollHeight - root.clientHeight - root.scrollTop <= 24
  }

  watch(
    [output, scope, element],
    ([text, currentScope, root], [, previousScope, previousRoot]) => {
      if (!text || currentScope !== previousScope || root !== previousRoot) following.value = true
      if (root && following.value) root.scrollTop = root.scrollHeight
    },
    { flush: 'post' }
  )

  return { onScroll }
}
