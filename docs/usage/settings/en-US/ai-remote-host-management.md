# Host Agent

This page manages embedded Host Agent capabilities. Its secondary tabs are `Conversation & Hosts`, `MCP`, `Skills`, and `Rules`. External Agent Hooks, AI Session Hibernation, desktop alerts, and Control Socket entries are configured in [AI Notifications](ai-notifications.md); MCP export for external Agents is configured in [Export MCP](export-mcp.md).

## Conversation & Hosts

This subpage manages command execution, context enrichment, security approval, and terminal wait behavior for embedded Codex and embedded AI chat.

## General

- Auto Execute Read-Only Commands: Allows low-risk read-only commands to run automatically within the confirmed scope. It does not bypass high-risk command approval.
- Command Output Filtering: Compresses the middle of long command output when sending it back to Agent context. The UI still keeps the full output.
- Knowledge Base Search: Automatically searches and attaches relevant knowledge-base documents for normal AI chat.
- Experience Extraction: Controls whether AI responses extract reusable operations experience.
- AI Session Auto-Naming: After an Agent turn ends, summarize the current session title into 2-5 words with the current model. Manual titles are not overwritten.
- Auto Approval: Allows low-risk read-only actions to pass automatically. High-risk commands still require approval.
- Security Config: Opens `security-config.json`, where command security policy, blacklist, whitelist, and risk approval rules are maintained.

## Terminal

- Shell Integration Timeout: Default time, in seconds, that Agent waits for terminal command output.

## MCP

The MCP subpage manages MCP Servers, Tools, and Resources available to aiopsterm's internal Agent. See [MCP Settings](mcp.md).

## Skills

The Skills subpage manages local skill packages. Enabled skills can be attached to AI chat context. See [Skills Settings](skills.md).

## Rules

The Rules subpage manages User Rules that constrain Agent behavior during conversation and command generation. See [Rules Settings](rules.md).
