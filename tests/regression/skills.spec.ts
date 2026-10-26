import { test, expect } from './support/desktop'

test('created skills return their saved content and survive restart @core', async ({ desktop }) => {
  const metadata = { name: 'regression-skill', description: 'Regression skill description' }
  const content = 'Regression skill content'
  const created = await desktop.api('createSkill', metadata, content)
  expect(created.skill).toMatchObject({ ...metadata, content, enabled: true, editable: true })
  expect(created.filePath).toBe(created.skill.path)
  await desktop.restart()
  const skills = await desktop.api('getSkills')
  expect(skills).toContainEqual(expect.objectContaining({ ...metadata, content, enabled: true }))
})
