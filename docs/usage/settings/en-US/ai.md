# AI Preferences

This page controls AI chat and Agent loop behavior.

## General

- Enable Extended Thinking: Enables additional reasoning-budget configuration.
- Budget: Token budget for Extended Thinking. Higher budgets can improve complex reasoning, but may increase cost and latency.
- Auto Execute Read-Only Commands: Allows low-risk read-only commands to run automatically within the confirmed scope. It does not bypass high-risk command approval.
- Command Output Filtering: Compresses the middle of long command output when sending it back to Agent context. The UI still keeps the full output.
- Knowledge Base Search: Automatically searches and attaches relevant knowledge-base documents for normal AI chat.
- Experience Extraction: Controls whether AI responses extract reusable operations experience.
- Auto Approval: Allows low-risk read-only actions to pass automatically. High-risk commands still require approval.
- Security Config: Opens `security-config.json`, where command security policy, blacklist, whitelist, and risk approval rules are maintained.

## Features

- OpenAI Reasoning Effort: Sets OpenAI reasoning intensity. `Low` is faster and cheaper; `High` favors complex reasoning.

## AI Model Proxy

- Enable Proxy: Routes AI model API requests through a proxy.
- Proxy Type: HTTP, HTTPS, SOCKS4, or SOCKS5.
- Host: Proxy server host.
- Port: Proxy server port.
- Enable Proxy Identity: Enables username/password authentication for the proxy.
- Username / Password: Proxy credentials.

## Terminal

- Shell Integration Timeout: Default time, in seconds, that Agent waits for terminal command output.
