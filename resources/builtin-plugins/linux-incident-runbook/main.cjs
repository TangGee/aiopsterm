'use strict'

const checks = [
  {
    id: 'overview',
    label: '系统概览',
    description: '负载、内存、磁盘和高 CPU 进程',
    command: 'uptime && free -h && df -h && ps aux --sort=-%cpu | head -n 15'
  },
  {
    id: 'services',
    label: '失败服务',
    description: '列出失败的 systemd 服务',
    command: 'systemctl --failed --no-pager'
  },
  {
    id: 'network',
    label: '网络监听',
    description: '列出监听端口和对应进程',
    command: 'ss -lntup'
  },
  {
    id: 'logs',
    label: '严重日志',
    description: '读取本次启动后的最近严重日志',
    command: 'journalctl -b -p err --no-pager -n 100'
  }
]

exports.activate = async function activate(context) {
  context.logger.info('Operations Toolkit activating')
  context.contexts.set('aiopsterm.operations-toolkit.ready', true)

  const run = context.commands.registerCommand('aiopsterm.operations-toolkit.run', async function runCheck(commandOrId) {
    const item = checks.find(function findCheck(check) {
      return check.id === commandOrId
    })
    const command = item ? item.command : String(commandOrId || '')
    if (!command) return { message: '没有可执行的检查命令' }
    const count = await context.globalState.get('runCount', 0)
    await context.globalState.update('runCount', Number(count || 0) + 1)
    return { terminalText: command, message: '检查命令已发送到当前终端' }
  })

  const refresh = context.commands.registerCommand('aiopsterm.operations-toolkit.refresh', function refreshChecks() {
    context.views.refresh('aiopsterm.operations-toolkit.checks')
    return { message: '运维检查项已刷新' }
  })

  const view = context.views.registerTreeDataProvider('aiopsterm.operations-toolkit.checks', {
    getChildren: function getChildren() {
      return checks.map(function toTreeItem(check) {
        return {
          id: check.id,
          label: check.label,
          description: check.description,
          collapsibleState: 'none',
          contextValue: 'runnable',
          command: 'aiopsterm.operations-toolkit.run',
          commandArgs: [check.id]
        }
      })
    }
  })

  const version = context.versions.registerProvider(function provideVersion() {
    return { plugin: '0.1.0', checks: checks.length }
  })

  context.subscriptions.push(run, refresh, view, version)
}

exports.deactivate = function deactivate() {}
