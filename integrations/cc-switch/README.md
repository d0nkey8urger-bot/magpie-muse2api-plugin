# 在 CC Switch 里用 Muse（muse2api 预设）

[CC Switch](https://github.com/farion1231/cc-switch) 是管 Claude Code / Codex / OpenCode 等工具配置的切换器。这份适配让它管的工具也能一键切到你的 muse2api 实例——**它只负责切换，实例本身要先跑起来**（用本仓库插件的一键托管装好，或你自己跑 muse2api 都行）。

## 一键导入（推荐）

在本仓库目录下跑这个小脚本，它会从托管目录 `~/.muse2api-plugin/.env` 读出你实例的 key，生成带好 key 的导入链接：

```sh
node integrations/cc-switch/make-link.mjs --app all
```

把打印出的链接（按你要用的工具挑一条）粘贴到浏览器地址栏打开，CC Switch 会弹出确认框，确认后供应商就导入好并自动启用。只要 Codex 的话去掉 `--app all` 即可；自己的实例用 `--key <你的 MUSE2API_KEY>`（地址不同再加 `--base <地址>`）。

## 手动添加（不用脚本）

在 CC Switch 里新建自定义供应商，照下表填：

| 字段 | 值 |
|---|---|
| 名称 | `Muse (muse2api)` |
| Endpoint / Base URL | `http://127.0.0.1:18610/v1` |
| API Key | 你实例的 `MUSE2API_KEY`（托管的在 `~/.muse2api-plugin/.env` 里） |
| 模型 | `muse-spark` |
| 上游格式（Codex） | Responses |

## 每个工具的说明

- **Codex**：导入即用。导入链接生成的配置里 `wire_api = "responses"`，正对 muse2api 的 `/v1/responses` 接口。
- **OpenCode**：导入即用（OpenAI 兼容格式，直连实例的聊天接口）。
- **Claude Code**：导入得到的是一个**直连**供应商，但 Claude Code 说的是 Anthropic 协议、muse2api 说的是 OpenAI 协议，直连答不了话——在 CC Switch 里把这个供应商切到**路由（代理）模式、上游格式选 Responses**，由 CC Switch 做协议转换，才能用。

## 排错

| 现象 | 原因 | 解决 |
|---|---|---|
| 导入时报 `API key is required` | 链接里的 key 是空的 | 用脚本生成链接，或手动填上实例的 key |
| 切换后请求连接失败 | 实例没在跑 | `magpie plugin login muse2api` 选第 1 个拉起托管实例，或手动启动你自己的实例 |
| 切换后报 401 | key 和实例对不上 | key 以实例 `.env` 里的 `MUSE2API_KEY` 为准，改完重新导入 |

> 核对方式：导入链接的每个字段都按 CC Switch 源码里的导入契约逐项验过（必填项、URL 规则、Codex 配置的生成形状与 TOML 可解析性）。CC Switch 是桌面 GUI，开发沙箱里跑不了它本体，最后点确认的那一下请在你自己机器上完成。
