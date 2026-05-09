---
title: 零成本搭建自己的博客：基于 Hexo & GitHub Pages
date: 2026-03-17 01:01:04
---

## 前言

拥有一个自己的博客可以很方便的记录技术成长。
博主大一的时候在 CSDN 上写了自己的第一篇博客，分享了一些在安装 Arch 和 Windows 双系统的时候踩过的坑。
后来开始捣鼓游戏制作又转战了 Reddit。但与其这样把自己的成长经历分散在各处，不如建立一个属于自己的博客，专注记录属于自己的点滴。

好了，闲言少叙，让我们开始吧！

## 安装并初始化 Hexo

首先，我们需要安装 Hexo，并在我们的博客目录下初始化他。
博主只会讲比较基础的部分，对于 Hexo 的高阶玩法，就需要大家自己去探索了。
这里是 [Hexo的官方文档](https://hexo.io/zh-cn/docs/)。

### 安装 Hexo

首先要确认一下我们是否已经安装了 Git。
打开任意一个终端或控制台，输入

```bash
git --version
```

如果还没安装可以到 [Git官网](https://git-scm.com/install/windows) 进行下载安装。
如果可以正常看到 Git 版本号，那么表示 Git 已经安装。
下面我们要确认 Node.js 是否已经安装。
同样在终端或控制台中输入

```bash
node --version
```

还没有安装的话可以到 [Node.js官网](https://nodejs.org/zh-cn/download/) 进行下载安装。
确认 Git 与 Node.js 都已经安装好以后准备工作就算是做完了。
现在我们来正式安装 Hexo。
控制台输入安装命令

```bash
npm install -g hexo-cli
```

进行安装。
安装完成后输入命令

```bash
hexo --version
```

如果看到 hexo-cli 的版本号就代表我们已经安装成功了。

### 初始化 Hexo

接下来我们开始初始化 Hexo。
输入命令（folder 是我们博客根目录的指定路径名，注意替换哦😉）

```bash
hexo init folder
```

可以在我们指定的目录下创建 Hexo 的基本文件。
使用

```bash
cd folder
```

可以进入到我们博客的根目录。
接着使用

```bash
npm install
```

来下载必备的模块。
至此，我们的 Hexo 也就算完成初始化了。
我们的博客也已经初具雏形。
可以使用

```bash
hexo server
```

来启动本地服务器。
我们可以在 [本地的4000端口](http://localhost:4000/) 访问到这个博客。

## 使用 GitHub Pages 部署博客到互联网

现在我们的博客只能本地访问，接下来我们会使用 GitHub Pages 将我们的博客部署到互联网上。
首先我们需要一个 GitHub 账号，如果还没有的话可以到 [GitHub官网](https://github.com/) 注册。

### 建立 GitHub 仓库

我们需要在 GitHub 上新建一个仓库，用于 Hexo 将我们的博客部署上去。
在我们 GitHub 上方选择 **Repositories** 进入我们的仓库页面，右上方选择 **New** 新建一个名为 **username.github.io** 的 **Public** 公开仓库（注意替换仓库名中的 username 为自己的 GitHub 用户名哦😉）。

### 配置 \_config.yml 文件

现在我们进入本地的博客根目录下，可以看到名称是 \_config.yml 的文件，这个我们博客的主要配置文件。
接下来我们修改 deploy 部分（repo 记得替换成你刚才新建的仓库的 URL 哦😉）

```yml
deploy:
  type: "git"
  repo: your github repository url
  branch: main
```

保存好后控制台输入

```bash
hexo clean && hexo deploy
```

进行部署。

### 设置 GitHub Pages

进入我们创建的仓库，上方点击 **Settings** 进入仓库设置，左侧找到 **Pages**，**Build and deployment** 下选择 **Deploy from a branch**，选择我们在 \_config.yml 里设置的 branch，然后我们就可以通过 GitHub Pages 给出的网址在线访问到我们的博客了（网址一般是 http://仓库名称/）。

## 尾声

至此，我们已经完成了博客的建立。
虽然现在我们的博客还很简陋，但 Hexo 支持很多很好看的社区主题，大家可以去到 [Hexo主题页面](https://hexo.io/themes/) 进行挑选。
我的博客使用的是 [Keep](https://github.com/XPoet/hexo-theme-keep)。
接下来的配置就靠各位自行探索了😉。
