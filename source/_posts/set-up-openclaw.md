---
title: 零成本安装配置 OpenClaw，但 OpenClaw 真的是必要的吗？
date: 2026-03-17 20:40:44
---

## 前言

相信大家最近经常听到一个词：龙虾🦞，也就是我们今天的主角：OpenClaw。
要了解 OpenClaw，我们首先要澄清一个误区：OpenClaw 并不是类似 Qwen 系列或者 GPT 系列的大语言模型（LLM），它本身没有“智能”，而是一个写死的程序。
OpenClaw 的本质是一个 AI Agent。对比之前的 Agent 产品，它更加轻量化，且不再强依赖云端，倾向于将记忆和数据存储在本地。
它的爆火或许是一个信号，说明 AI Agent 技术正在逐渐趋于成熟。

但同时，博主认为，AI Agent 并不像被炒作的那样——“你现在不用就会被淘汰”。
在博主看来，现阶段 AI Agent 的使用性价比，或许远低于直接去各家 LLM 官网免费试用他们的大模型。
因为刚才也说过了，AI Agent 本身不是人工智能，它需要连接一个 LLM 作为“大脑”，单独的 Agent 基本上什么都做不了(Agent 的内部规则限制当然对于其使用体验也起到至关重要的作用，但这需要花费比较多的时间和精力去调整)。

这里就涉及到两个现实问题：首先，各大公司并不一定会开源他们官网上最先进的 LLM；其次，开源的大参数 LLM（16B 往上）在普通人的电脑上基本跑不起来。
比如 Qwen 的开源系列，一般大家的显存大概在 8G 上下，这个配置大概只能跑得动 9B 参数的模型（或许勉强可以往上一点，但参数越多响应越慢）。
但很遗憾，如果我们想把 9B 参数大小的 LLM 连上 OpenClaw 进行使用，体验大概率还是不够好。
刚才不是说可以勉强跑得动吗，为什么现在又不太行了？
因为 OpenClaw 这种 AI Agent 对 LLM 的调用方式，和我们直接跟 LLM 聊天是不一样的。
我们输入“你好”，LLM 收到的 prompt 最多是“用户说：你好。你回答：”，或者加上之前的聊天记录。
但 OpenClaw 会把配置文件里的内容、用户的输入全部打包给到 LLM，而且我们的一次对话，在 OpenClaw 与 LLM 之间可能会进行多次交互。

既然本地跑不动，那不能使用云端 LLM 吗？
可以，但是要付费（虽然有免费云端服务，但智能程度有限）。
而且正如刚才所讲，OpenClaw 每次交互消耗的 Token 数量很多，且一段对话往往涉及多次调用。
所以这个消费在博主看来，对于日常使用而言是比较夸张的。

铺垫了这么多，博主主要是想表达一个核心观点：OpenClaw 并不是对所有人都“非装不可”。
对于计算机软件或互联网行业的从业者来说，学习和研究 OpenClaw 这样的前沿热门软件是很有必要的。这不仅是体验一个新工具，更是为了理解 AI Agent 的架构与逻辑，保持对技术趋势的敏感度，这对职业发展至关重要。
但对于其他行业的普通人来说，如果你的目的仅仅是出于好奇想“玩一下”，那当然可以尝试；但如果你打算为此真正付出大量的时间去搭建，甚至花费金钱去培养一个专属的 OpenClaw，博主认为目前的性价比并不高。
或许在未来，低成本的个人 AI Agent 真的会成为我们每个人日常生活中不可分割的一部分，但至少在当下，它并非大众的必需品。

好了，如果你有耐心看到这里，并且确实属于上述想要“尝鲜”或“学习”的人群，那就让我们继续吧。

## 安装配置 OpenClaw

### 安装

先把 [OpenClaw的官方文档](https://docs.openclaw.ai/) 给大家。
这边博主会使用 NPM 带大家安装，如果还没有安装 Node.js，可以到 [官网](https://nodejs.org/zh-cn/download/) 下载安装一下。
接下来我们使用

```bash
npm install -g openclaw@latest
```

来全局安装 OpenClaw。
完成后输入

```bash
openclaw --version
```

来确认是否安装成功。

### 配置

终端输入

```bash
openclaw onboard --install-daemon
```

就可以进入 OpenClaw 的终端交互式配置界面（如果这里的配置选错了也没有关系，我们后续可以在配置文件进行修改）。
我们选择 **Quick Start**。
博主这里的 LLM 供应商选择 **OpenRouter**，选择其他的大家也可以自行配置，流程都是一样的，进入官网，然后 Get API Key，然后填进去就可以了。
如果想用本地的 LLM，可以选择 Ollama（LLM 不需要再去手动选择调教版本了，但 Ollama 的速度会很慢）或者 vLLM。
接着会让我们输入 **OpenRouter** 的 API Key。
我们来到 [OpenRouter的官网](https://openrouter.ai/)，点击 **Get API Key**，然后创建一个复制过来。
模型的话各位就自行挑选了，可以在 OpenRouter 里面搜索 **free**，然后进行选择。

接下来配置 Channel，如果各位只需要在网页进行对话那这一步可以跳过。
这里博主使用 Telegram 进行演示。
我们选择 Telegram，然后需要输入 Bot API Token。
我们打开 Telegram，搜索 BotFather（或者点这个 [网址](https://telegram.me/BotFather)）。
输入 /new 根据指引创建一个新的机器人。
创建完成以后复制他的 API Token 过来。

接下来配置搜索引擎，博主这里使用 Gemini AI 搜索来做演示。
首先我们到 [Gemini API Key](https://aistudio.google.com/app/api-keys) 去创建一个新的 API Key（使用默认的也可以），然后复制过来。

接下来是配置 Skills 和 Hooks，可以直接跳过。

然后我们就完成了 OpenClaw 的基本配置。
如果没有自动启动 Gateway 的话我们可以手动输入

```bash
openclaw gateway
```

来启动 Gateway 进程，或者使用

```bash
openclaw gateway start
```

来执行 gateway.cmd。
如果提示权限不够，可以使用管理员模式运行终端。

接着我们回到 Telegram，搜索我们刚才创建的 Bot，点击底部 **start**，OpenClaw 会给我们发一个配对码，我们使用

```bash
openclaw pairing approve telegram 配对码
```

来进行配对。
完成后我们的 OpenClaw + Telegram 就已经配对完成了，大家现在可以在 Telegram 内使用我们的 OpenClaw 了。

## Skills 的安装

有关 Skills 的安装，各位的需求各不相同，所以博主就只推荐比较全面热门的 Skills，剩下的部分，就留给各位自行探索了。
**提醒**：安装 Skill 时请注意 Skill 的安全性，谨防病毒入侵。

### 如何安装 Skills

1. 通过 [ClawHub官网](https://clawhub.ai/) 下载安装。
下载解压后放到当前 workspace/ 目录下的 skills/ 目录下（如果没有需要自己创建一下）
2. 通过控制台的 clawhub 进行安装。
我们可以先输入

```bash
clawhub search 我们想要安装的 skill
```

来看看有没有我们想要的 Skills，也可以直接在 [ClawHub官网](https://clawhub.ai/) 搜索后复制 Skill 网址末尾的名称到控制台

```bash
clawhub install skill名称
```

来进行安装
3. 要想安装 ClawHub 以外的 Skills 的话，我们需要在 GitHub 上找到想要安装的 Skill，然后使用

```bash
npx skills add github仓库链接
```

来进行安装。

### 推荐的 Skills

1. [Skill Vetter](https://clawhub.ai/spclaudehome/skill-vetter)。可以审计安装的 Skills 是否安全
2. [Self-Improving + Proactive Agent](https://clawhub.ai/ivangdavila/self-improving)。帮助 Agent 自动提升的 Skill
3. [Tavily 搜索](https://clawhub.ai/Jacky1n7/openclaw-tavily-search)。调用 Tavily AI Search 进行网络搜索，Tavily 提供每月 1000 次的免费搜索
4. [Find Skills](https://clawhub.ai/JimLiuxinghai/find-skills)。可以自动查找需要的 Skills。

## 尾声

至此，我们的 OpenClaw 就已经基本配置完成了，各位如果还想深入探索，可以多去查询 [OpenClaw的官方文档](https://docs.openclaw.ai/)。
同时在文章的最后，博主还是要提醒大家，OpenClaw 的默认权限很大，一定要小心本地文件被他在默认执行的时候修改掉。

