export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the textarea fallback for restricted browser clipboard contexts.
    }
  }

  const execCopy = document.execCommand?.bind(document)
  if (!execCopy) return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    return execCopy('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

export const mirrorTextToClipboardQuietly = async (text: string): Promise<boolean> => {
  if (!navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export type ClipboardTextReadResult =
  | { ok: true; text: string }
  | { ok: false; error: 'unavailable' | 'rejected'; message: string }

export const readTextFromClipboard = async (): Promise<ClipboardTextReadResult> => {
  if (!navigator.clipboard?.readText) {
    return { ok: false, error: 'unavailable', message: 'Clipboard read service unavailable.' }
  }
  try {
    return { ok: true, text: await navigator.clipboard.readText() }
  } catch (error) {
    return {
      ok: false,
      error: 'rejected',
      message: error instanceof Error && error.message ? error.message : 'Clipboard read failed.'
    }
  }
}
