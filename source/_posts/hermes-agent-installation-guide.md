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

## 前言

最近博主在折腾 AI Agent 的时候，注意到了 Nous Research 家的 Hermes Agent。
今天就带大家一起把它装起来、配好，顺便说说博主自己踩过的几个点。

Hermes Agent 是 Nous Research 开发的一个自主 AI 智能体，它不只是一个简单的聊天机器人，也不是 IDE 插件，而是一个真正意义上的自主代理。
它会随着使用时间变得越来越强大。
而且它对硬件几乎没什么要求，从低配置的 **$5 VPS** 到 GPU 集群都能跑，像 Daytona 或 Modal 这类 serverless 基础设施也可以（空闲时基本不产生费用）。
你可以通过 Telegram 和它对话，而它可能正在一台你从没 SSH 进去过的云虚拟机上干活。

博主认为 Hermes Agent 比较有意思的地方在于它内置的学习循环：它能够从经验中创建技能，在使用过程中不断改进这些技能，主动推动自己持续学习，并且会随着时间推移建立起对你的深度理解。

好了，闲言少叙，让我们开始吧！

## 安装 Hermes Agent

### 安装

Hermes Agent 提供了官方的一键安装脚本，支持 Linux、macOS、WSL2 和 Android（Termux）。
打开你的终端，运行

```bash
# Linux / macOS / WSL2 / Android (Termux)
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

来进行安装。

**提醒**：Windows 用户需要先安装 [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install)，然后在 WSL2 的终端里运行上面的命令。

安装完成后，重新加载一下你的 shell 配置

```bash
source ~/.bashrc  # 或者 source ~/.zshrc
```

如果你用的是 fish，需要在 config.fish 里设置一下

```bash
fish_add_path $HOME/.local/bin:$PATH
```

### 配置 LLM 提供商

安装完成后，我们还需要配置一个 LLM 提供商，Hermes Agent 才能真正用起来。
这边博主使用 **OpenRouter** 的免费模型来做演示，选择其他的大家也可以自行配置，流程都是一样的。

#### 获取 OpenRouter API Key

1. 访问 [OpenRouter 官网](https://openrouter.ai/) 并注册账号
2. 登录后，前往 [API Keys 页面](https://openrouter.ai/keys)
3. 点击 **Create Key** 创建一个新的 API Key
4. 为你的 Key 命名（比如 "Hermes Agent"），然后复制生成的 Key

#### 配置 OpenRouter

如果在安装时跳过了配置，现在可以在终端里运行

```bash
hermes config set OPENROUTER_API_KEY sk-or-your-actual-key-here
```

来设置 OpenRouter 的 API Key。

**提示**：`hermes config set` 命令会自动把 API Key 保存到 `~/.hermes/.env` 文件中，这是存储敏感信息的正确位置。

接下来我们设置默认使用的模型，输入

```bash
hermes model
```

会启动一个交互式选择器，我们可以在里面浏览和选择不同的提供商和模型。
选择 OpenRouter 后，可以挑选 `anthropic/claude-3-haiku`、`meta-llama/llama-3-8b-instruct` 等免费模型。

当然，也可以直接指定

```bash
hermes config set model anthropic/claude-3-haiku
```

来进行设置。

## 配置消息网关（Telegram）

为了能够通过 Telegram 和 Hermes Agent 交互，我们需要创建一个 Telegram Bot，并获取自己的 Telegram ID。
当然也可以不使用 Telegram，Hermes Agent 也支持微信。

### 创建 Telegram Bot

1. 在 Telegram 中搜索 @BotFather 并开始对话
2. 发送 `/newbot` 命令
3. 按照提示为你的 Bot 命名（比如 "MyHermesBot"），并设置用户名（必须以 `bot` 结尾）
4. BotFather 会给你一个 HTTP API Token，格式类似 `123456789:AAABBBCCCDDD111222333aaa...`

**重要**：请妥善保存这个 Token，这是你 Bot 的密钥！

### 获取你的 Telegram ID

1. 在 Telegram 中搜索 @userinfobot 并开始对话
2. 发送任意消息（比如 `/start`）
3. userinfobot 会回复你的用户信息，其中包括你的 ID（一个数字，比如 `123456789`）

### 配置 Hermes Agent 的 Telegram 网关

拿到这些信息之后，我们把它配置到 Hermes Agent 里

```bash
# 设置 Telegram Bot Token
hermes config set telegram.token 123456789:AAABBBCCCDDD111222333aaa...

# 设置允许的用户 ID（你自己的 ID）
hermes config set telegram.allowed_ids 123456789
```

来进行配置。

**提示**：如果你想让多个用户都能使用你的 Hermes Agent，可以把多个 ID 用逗号分隔：`hermes config set telegram.allowed_ids 123456789,987654321,111222333`

## 配置 Fallback Model（后备模型）

配置 Fallback Model 是为了在主要模型出问题的时候（比如触发速率限制、服务器错误或认证失败），Hermes Agent 能够自动切换到备用模型，而不会丢失对话上下文。

根据官方文档，Fallback Model 需要在 `~/.hermes/config.yaml` 中配置

```yaml
fallback_model:
  provider: openrouter                    # 必需
  model: anthropic/claude-sonnet-4        # 必需
  # base_url: http://localhost:8000/v1    # 可选，用于自定义端点
  # api_key_env: MY_CUSTOM_KEY            # 可选，自定义端点的 API key 环境变量名
```

具体步骤如下：

1. 打开配置文件

   ```bash
   hermes config edit
   ```

2. 在文件末尾添加 `fallback_model` 配置

   ```yaml
   fallback_model:
     provider: openrouter
     model: anthropic/claude-sonnet-4
   ```

3. 保存并退出编辑器

**提醒**：

- `provider` 和 `model` 都是必需字段，缺一不可
- Fallback 只能通过 `config.yaml` 配置，没有对应的环境变量
- 激活后，Fallback 会在会话中途切换模型和提供商，且不会丢失对话
- 每个会话最多只会触发一次 Fallback
- 支持的提供商包括：openrouter、nous、openai-codex、copilot、copilot-acp、anthropic、huggingface、zai、kimi-coding、minimax、minimax-cn、deepseek、ai-gateway、opencode-zen、opencode-go、kilocode、xiaomi、alibaba、custom

### 验证配置

我们可以随时输入

```bash
hermes config
```

来查看当前的完整配置，其中也包括 `fallback_model` 部分。

## 开始使用 Hermes Agent

一切配置完成之后，我们就可以开始使用 Hermes Agent 了。
在终端中运行

```bash
hermes chat
```

就会启动一个交互式聊天会话。
如果你已经配置好了 Telegram 网关，也可以在 Telegram 里找到刚才创建的 Bot，发送 `/start` 开始对话。

## 尾声

听说 Hermes Agent 自带的学习能力很强，博主已经等不及要试一下了😉。

**提醒**：Hermes Agent 的默认权限同样不小，使用的时候要留意本地文件被它修改。

---

*本文档基于 Hermes Agent 最新官方文档编写，如有出入，请以官方文档为准。*
