# Troubleshooting

## Runtime Logs

aiopsterm writes runtime diagnostics to:

```text
<userData>/logs/aiopsterm-runtime.log
```

On a normal Linux development run, `<userData>` is usually:

```text
~/.config/aiopsterm
```

The terminal diagnostics include local/SSH terminal create, lifecycle, write, resize, kill, and backend data events. Terminal write logs intentionally record byte counts and session metadata only; command text and secrets are not written to the runtime log.

When reporting a terminal input problem, include the recent `terminal.*` and `renderer.terminal-*` entries from this file.
