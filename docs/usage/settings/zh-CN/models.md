# 模型设置

本页管理 AI 对话和 Codex CLI 可用的模型列表与 Provider 配置。

## 模型名称

- 模型勾选框：控制模型是否在 AI 对话选择器中可用。锁定模型不能关闭。
- 锁定标识：表示该模型由系统内置或受保护，不能删除或停用。
- Thinking 标识：表示该模型是带推理/Thinking 语义的模型。
- 管理名称：自定义模型在设置页和模型选择器里显示的名称，不改变真实模型 ID。
- Provider 标签：展示模型当前绑定的 Provider，例如 Built-in、OpenAI Compatible、Ollama 等。
- 移除模型配置：仅对可编辑的自定义模型出现，用于删除该模型配置。
- 添加模型：打开或关闭 Provider 配置区域。关闭后只显示模型列表，不展示 API 配置表单。

## API 配置

- LiteLLM Base URL：LiteLLM 网关地址。
- OpenAI Base URL：OpenAI compatible 或 Responses API 地址。末尾追加 `#` 可跳过自动补 `/v1` 的逻辑。
- API Format：OpenAI Provider 的请求格式。普通 AI 对话可按配置使用；Codex CLI 侧只支持 Responses。
- API Key：Provider 的访问密钥。保存后用于后续请求。
- Model：Provider 默认模型 ID，也是检查和保存配置时使用的模型。
- Check：调用后端检查当前 Provider 配置是否可用。
- Save：保存当前 Provider 配置，并让后续 AI 请求使用该配置。

## Provider 专项字段

- Amazon Bedrock：需要 AWS Access Key、AWS Secret Key、可选 Session Token 和 AWS Region。启用 AWS VPC Endpoint 后会显示 Bedrock Endpoint。Cross Region Inference 控制是否使用跨区域推理能力。
- DeepSeek：配置 DeepSeek API Key。
- Anthropic：配置 Anthropic Base URL 和 API Key。
- Ollama：配置 Ollama Base URL。Codex CLI 会按 OpenAI-compatible `/v1` 路径使用。
- LM Studio：配置 LM Studio Base URL，需要 LM Studio 开启 OpenAI Compatible Server。

## 通用

- 启用 Extended Thinking：开启后，AI 请求会使用额外推理预算相关配置。
- Budget：Extended Thinking 的 token 预算。预算越高，模型可用于推理的 token 越多，但请求成本和耗时也可能增加。

## 功能

- OpenAI Reasoning Effort：设置 OpenAI 模型的推理强度。`低` 更快更省，`高` 更偏向复杂推理。

## AI 模型代理

- 启用代理：控制 AI 模型 API 请求是否通过代理访问。
- 代理类型：选择 HTTP、HTTPS、SOCKS4 或 SOCKS5。
- Host：代理服务器地址。
- Port：代理服务器端口。
- 启用代理身份：代理需要用户名密码时开启。
- Username / Password：代理身份认证凭据。

保存配置只影响后续新请求；已经发出的 AI 请求不会被中途切换。
