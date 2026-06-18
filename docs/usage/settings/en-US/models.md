# Model Settings

This page manages model availability and Provider configuration for AI chat and Codex CLI.

## Model Names

- Model checkbox: Makes a model available or unavailable in model pickers. Locked models cannot be disabled.
- Locked icon: The model is built in or protected and cannot be removed or disabled.
- Thinking icon: The model has Thinking or reasoning semantics.
- Display Name: Custom display name for the model. It does not change the real model ID.
- Provider label: Shows the model Provider, such as Built-in, OpenAI Compatible, or Ollama.
- Remove model config: Removes editable custom model configuration.
- Add Model: Shows or hides the Provider configuration area.

## API Configuration

- LiteLLM Base URL: LiteLLM gateway URL.
- OpenAI Base URL: OpenAI-compatible or Responses API URL. Add `#` at the end to skip automatic `/v1` insertion.
- API Format: Request format for the OpenAI Provider. Codex CLI supports Responses.
- API Key: Provider access key used for later requests.
- Model: Provider default model ID.
- Check: Asks the backend to validate the current Provider configuration.
- Save: Saves the current Provider configuration for later AI requests.

## Provider-Specific Fields

- Amazon Bedrock: Configure AWS Access Key, AWS Secret Key, optional Session Token, and AWS Region. Enabling AWS VPC Endpoint shows Bedrock Endpoint. Cross Region Inference controls cross-region inference use.
- DeepSeek: Configure DeepSeek API Key.
- Anthropic: Configure Anthropic Base URL and API Key.
- Ollama: Configure Ollama Base URL. Codex CLI uses the built-in Ollama provider through an OpenAI-compatible `/v1` path.
- LM Studio: Configure LM Studio Base URL. LM Studio must enable its OpenAI Compatible Server.

Saved changes affect later requests, not already-running AI requests.
