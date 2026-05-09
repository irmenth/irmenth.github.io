---
title: Hermes Agent 安装与配置完整指南
date: 2026-04-12 02:45:00
tags:
  - Hermes Agent
  - AI Agent
  - 安装教程
  - OpenRouter
  - Telegram
---

# 什么是 Hermes Agent？

Hermes Agent 是由 Nous Research 开发的自主 AI 智能体，它不仅仅是一个简单的聊天机器人或 IDE 插件。Hermes Agent 是一个真正的自主代理，它会随着使用时间变得越来越强大。它可以运行在几乎任何地方——从低配置的 $5 VPS 到 GPU 集群，甚至是像 Daytona 或 Modal 这样的服务器less 基础设施（在空闲时几乎不产生费用）。你可以通过 Telegram 与它交谈，而它可能正在一台你从未 SSH 进入过的云虚拟机上工作。

Hermes Agent 的独特之处在于其内置的学习循环——它能够从经验中创建技能，在使用过程中改进它们，主动推动自己持续学习知识，并且能够随着时间的推移建立起对你的深度理解。

# 安装 Hermes Agent

## 步骤 1：安装 Hermes Agent

Hermes Agent 提供了一键安装脚本，支持 Linux、macOS、WSL2 和 Android（Termux）。

打开你的终端，运行以下命令：

```bash
# Linux / macOS / WSL2 / Android (Termux)
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

> **Windows 用户注意**：请先安装 [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install)，然后在 WSL2 终端中运行上面的命令。

安装完成后，重新加载你的 shell 配置：

```bash
source ~/.bashrc  # 或者 source ~/.zshrc
```

fish 需要在 config.fish 中设置：

```bash
fish_add_path $HOME/.local/bin:$PATH
```

## 步骤 2：设置您的 LLM 提供商

安装完成后，您需要配置一个 LLM 提供商才能使用 Hermes Agent。根据您的需求，您可以选择不同的提供商。

在本指南中，我们将使用 **OpenRouter** 的免费模型作为主要提供商。

### 获取 OpenRouter API Key

1. 访问 [OpenRouter 官网](https://openrouter.ai/) 并注册账号
2. 登录后，前往 [API Keys 页面](https://openrouter.ai/keys)
3. 点击 "Create Key" 创建一个新的 API key
4. 为您的 key命名（例如 "Hermes Agent"），然后复制生成的 key

### 配置 OpenRouter 到 Hermes Agent

如果在安装时跳过了配置，现在可以在终端中运行以下命令来设置 OpenRouter API key：

```bash
hermes config set OPENROUTER_API_KEY sk-or-your-actual-key-here
```

> 提示：`hermes config set` 命令会自动将 API key 保存到 `~/.hermes/.env` 文件中，这是存储敏感信息的正确位置。

接下来，设置默认使用的模型。OpenRouter 提供许多免费模型可供选择。例如，我们可以使用：

```bash
hermes model
```

这将启动一个交互式选择器，让您可以浏览和选择不同的提供商和模型。选择 OpenRouter 后，您可以选择如 `anthropic/claude-3-haiku`、`meta-llama/llama-3-8b-instruct` 等免费模型。

或者，您也可以直接设置：

```bash
hermes config set model anthropic/claude-3-haiku
```

# 配置消息网关（Telegram）

为了能够通过 Telegram 与 Hermes Agent 交互，我们需要创建一个 Telegram Bot 并获取您的 Telegram ID（当然也可以不使用 Telegram，Hermes Agent 也支持微信）。

## 创建 Telegram Bot

1. 在 Telegram 中搜索 @BotFather 并开始对话
2. 发送 `/newbot` 命令
3. 按照提示为您的 bot命名（例如 "MyHermesBot"）并设置用户名（必须以 `bot` 结尾，例如 "MyHermesBot"）
4. BotFather 将为您提供一个 HTTP API token，格式如：`123456789:AAABBBCCCDDD111222333aaa...`  **重要：请妥善保存这个 token，这是您 bot 的密钥！**

## 获取您的 Telegram ID

1. 在 Telegram 中搜索 @userinfobot 并开始对话
2. 发送任何消息（例如 `/start`）
3. userinfobot 将回复您的用户信息，包括您的 ID（一个数字，例如 `123456789`）

## 配置 Hermes Agent 的 Telegram 网关

现在，我们需要将这些信息配置到 Hermes Agent 中：

```bash
# 设置 Telegram Bot Token
hermes config set telegram.token 123456789:AAABBBCCCDDD111222333aaa...

# 设置允许的用户 ID（您的 ID）
hermes config set telegram.allowed_ids 123456789
```

> 提示：如果您想允许多个用户使用您的 Hermes Agent，可以将多个 ID 用逗号分隔：`hermes config set telegram.allowed_ids 123456789,987654321,111222333`

# 配置 Fallback Model（后备模型）

为了确保在主要模型遇到问题（如速率限制、服务器错误或认证失败）时 Hermes Agent 能够自动切换到备用模型而不会丢失对话上下文，我们需要配置 fallback model。

根据官方文档，fallback model 配置需要在 `~/.hermes/config.yaml` 中添加以下部分：

```yaml
fallback_model:
  provider: openrouter                    # 必需
  model: anthropic/claude-sonnet-4        # 必需
  # base_url: http://localhost:8000/v1    # 可选，用于自定义端点
  # api_key_env: MY_CUSTOM_KEY           # 可选，自定义端点的 API key 环境变量名
```

## 步骤：配置 Fallback Model

1. 打开配置文件编辑器：
   ```bash
   hermes config edit
   ```

2. 在文件末尾添加 fallback_model 配置：
   ```yaml
   fallback_model:
     provider: openrouter
     model: anthropic/claude-sonnet-4
   ```

3. 保存并退出编辑器

> **重要提示**：
> - `provider` 和 `model` 都是必需的字段，缺一不可
> - fallback 仅通过 `config.yaml` 配置，没有对应的环境变量
> - 当激活时，fallback 会在会话中途切换模型和提供商而不会丢失对话
> - 每个会话最多只会触发一次 fallback
> - 支持的提供商包括：openrouter, nous, openai-codex, copilot, copilot-acp, anthropic, huggingface, zai, kimi-coding, minimax, minimax-cn, deepseek, ai-gateway, opencode-zen, opencode-go, kilocode, xiaomi, alibaba, custom

## 验证配置

您可以随时检查当前的配置：

```bash
hermes config
```

这将显示您当前的完整配置，包括 fallback_model 部分。

# 开始使用 Hermes Agent

一切配置完成后，您就可以开始使用 Hermes Agent 了！

在终端中运行：

```bash
hermes chat
```

这将启动一个交互式聊天会话。如果您已经配置了 Telegram 网关，您也可以在 Telegram 中找到您刚才创建的 bot，发送 `/start` 开始对话。

# 尾声

听说 Hermes Agent 自带的学习能力很强，等不及要试一下了呢！

---
*本文档基于 Hermes Agent 最新官方文档编写，如有出入，请以官方文档为准。*