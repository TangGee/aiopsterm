# Command Security Settings

This page is under `Settings -> Host Agent -> Conversation & Hosts -> Command Security`. It controls checks applied before structured commands are written to a terminal.

Command security applies to command input, global execution, quick commands, and Agent execution. Direct typing and paste inside a terminal pane, including right-click, middle-click, the context menu, and `Ctrl+Shift+V`, do not pass through command security. Manual paste still uses normal terminal session checks, write-result validation, and error reporting.

## Visual Settings

- Enable command security: Disables or enables length, list, and dangerous-command checks for structured commands.
- Strict allow-list mode: Blocks structured commands that do not match the allow list.
- Maximum command length: Blocks longer structured commands. The allowed range is `1` to `100000`.
- Critical command policy: Select Block or Ask before execution.
- High-risk, medium-risk, and block-list policies: Select Block or Ask before execution for each category.
- Dangerous commands: One executable name per line, such as `rm` or `shutdown`.
- Block-list and allow-list patterns: One pattern per line. `*` wildcards are supported.
- Restore defaults: Restores the complete command security configuration.
- Advanced JSON Config: Opens the complete configuration file editor.

Empty lines, surrounding whitespace, and duplicate list entries are removed when a multiline field is saved.

## Advanced JSON Config

The editor toolbar shows the actual configuration file path. The Linux default is `~/.config/aiopsterm/security-config.json`; use the path shown by the editor on other platforms.

Complete example:

```json
{
  "security": {
    "enableCommandSecurity": true,
    "enableStrictMode": false,
    "blacklistPatterns": [],
    "whitelistPatterns": [
      "ls",
      "pwd",
      "whoami",
      "date"
    ],
    "dangerousCommands": [
      "rm",
      "format",
      "shutdown"
    ],
    "maxCommandLength": 10000,
    "securityPolicy": {
      "blockCritical": true,
      "askForMedium": true,
      "askForHigh": true,
      "askForBlacklist": false
    }
  }
}
```

Field behavior:

- `enableCommandSecurity`: Master command security switch.
- `enableStrictMode`: Enables strict allow-list enforcement.
- `blacklistPatterns`: Matching commands use the `askForBlacklist` policy.
- `whitelistPatterns`: Commands allowed when strict mode is enabled.
- `dangerousCommands`: Executable names classified as dangerous.
- `maxCommandLength`: Maximum structured-command character count.
- `blockCritical`: `true` blocks critical commands; `false` asks before execution.
- `askForMedium`, `askForHigh`, and `askForBlacklist`: `true` asks before execution; `false` blocks.

Checks run in this order: maximum length, block list, dangerous command, then strict allow list. Compound commands joined by `;`, `&&`, or `||` are checked segment by segment. `*` in a pattern matches arbitrary text.

The editor validates and normalizes JSON. A failed save does not replace the confirmed runtime configuration. Do not disable command security to work around manual terminal paste; manual paste already bypasses this policy.
