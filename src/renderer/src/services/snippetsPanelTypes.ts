export type SnippetsCommandMenu = {
  visible: boolean
  x: number
  y: number
  commandId: number
}

export type SnippetsGroupMenu = {
  visible: boolean
  x: number
  y: number
  groupUuid: string
}

export type SnippetsCommandForm = {
  name: string
  content: string
  groupUuid: string
}
