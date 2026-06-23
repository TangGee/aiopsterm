export type UserLoginDraft = {
  username: string
  password: string
  email: string
  emailCode: string
  mobile: string
  mobileCode: string
}

export type UserProfileDraft = {
  name: string
  username: string
}

export type UserAvatarOffset = {
  x: number
  y: number
}
