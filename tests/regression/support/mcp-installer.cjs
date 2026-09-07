const fs = require('node:fs')
const path = require('node:path')

// Only emulates the external CLI's config-write contract, never model behavior.
const root = process.env.AIOPSTERM_REGRESSION_ROOT
const home = process.env.CODEX_HOME
if (!root || !home || path.resolve(home) !== path.join(root, 'home', '.codex')) throw new Error('Isolated Codex home required')
const args = process.argv.slice(2)
if (args[0] !== 'mcp' || !['add', 'remove'].includes(args[1])) throw new Error('Only MCP configuration commands are supported')
const name = args[2]
if (!/^aiopsterm_[a-z_]+$/.test(name)) throw new Error('Unexpected MCP server name')
fs.mkdirSync(home, { recursive: true })
const file = path.join(home, 'config.toml')
const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
const blocks = source.split(/(?=\[mcp_servers\.)/).filter((block) => !block.startsWith(`[mcp_servers.${name}]`) && !block.startsWith(`[mcp_servers.${name}.env]`))
if (args[1] === 'add') {
  const separator = args.indexOf('--')
  if (separator < 0) throw new Error('Missing MCP command')
  const env = {}
  for (let index = 3; index < separator; index++) {
    if (args[index] !== '--env') continue
    const pair = args[++index]
    const split = pair.indexOf('=')
    env[pair.slice(0, split)] = pair.slice(split + 1)
  }
  blocks.push(`[mcp_servers.${name}]\ncommand = ${JSON.stringify(args[separator + 1])}\nargs = ${JSON.stringify(args.slice(separator + 2))}\n`)
  blocks.push(`[mcp_servers.${name}.env]\n${Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n')}\n`)
}
fs.writeFileSync(file, blocks.join(''))
