# 在 DeepSeek Harness（dsh）里用 Muse

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的模型层原生支持自定义 OpenAI 兼容接口，所以这个适配**不用写插件**：把 muse2api 作为一个 custom provider 接进去就行。前提和别处一样：实例先跑起来（本仓库插件的一键托管，或你自己跑）。

## 方法一：在界面里填（最简单）

启动 `dsh web`，打开 **Settings → Models → Add model provider → Custom model API**，照填：

| 字段 | 值 |
|---|---|
| Provider ID | `muse2api`（一旦保存不要改名，改名等于新建） |
| Base URL | `http://127.0.0.1:18610/v1` |
| API protocol | OpenAI Chat Completions |
| API key | 你实例的 `MUSE2API_KEY`（托管的在 `~/.muse2api-plugin/.env` 里） |
| Model | `muse-spark`（也可以点 Fetch available models 让它自己拉列表） |

保存后在模型选择器里选 `muse-spark` 即可。

## 方法二：配置文件（可复现）

把本目录的 [`cordis.patch.yml`](cordis.patch.yml) 里的两个 provider 条目合并进 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（`dsh web` 的 profile 是 `web`）中 `llm-pi-ai` 条目的 `config.providers` 下；文件里还没有这个条目时，整段可以直接作为 patch 的一条。

配置里不写 key，而是让 dsh 从环境变量读。启动 dsh 的那个终端里先执行：

```sh
eval "$(node integrations/deepseek-harness/make-env.mjs)"
dsh web
```

脚本从托管目录读出 key 并打印 `export` 行；自己的实例用 `--key` 传。

想让 dsh 一启动就默认用 Muse，再叠加本目录的 `cordis.patch.default-model.yml`（把默认 provider/model 换成 `muse2api`/`muse-spark`）：`dsh web --patch integrations/deepseek-harness/cordis.patch.yml --patch integrations/deepseek-harness/cordis.patch.default-model.yml`，或把这条也合并进 profile 的 patch 文件。

## 两个协议条目，怎么选

配置里给了两个 provider：`muse2api`（Chat Completions）和 `muse2api-responses`（Responses）——dsh 里一个 provider 只能说一种协议，而 muse2api 两种都提供。**默认用 Chat Completions 这条**：它是 muse2api 最原始、被用得最多的接口，dsh 的兼容开关也只在这条上生效；Responses 那条留作对照，哪个顺手用哪个。Chat Completions 条目上预置了 `compat.maxTokensField: max_tokens`（muse2api 认的是经典的输出上限字段）；若遇到网关拒绝请求，dsh 文档里同类问题的另一个常见开关是 `compat.supportsDeveloperRole: false`，可按需加上。

## 先说清的短板

- dsh 的 agent 循环很吃工具调用，而 muse2api 的 tool call 是从网页模型的回复里**模拟**出来的——普通活能干，复杂工具组合是最先出问题的地方，和在其他 agent 里一样。
- dsh 还在 developer preview，官方明说会有破坏性变更；这份配置的字段形状（`llm-pi-ai` 的 `providers`/`apiKeyEnv`/`api`/`compat`）按当前版本的文档与配置目录写的，它改版时这里可能要跟着改。
- key 用界面填的话由 dsh 自己存进它的凭证文件；用配置文件法的话只存在于你终端的环境变量里，不落进任何配置文件。

> 核对方式：字段与取值按 dsh 官方 providers 指南和生成的配置目录核对；并且已在开发沙箱里真机验过——装上 dsh 后，这份 patch 能正确合成进 profile 配置（`--dump-config` 可见两个 provider 与 compat 开关），headless 实跑时请求真打到了 muse2api 实例、实例的回复（沙箱里的实例没有 Muse 账号，回的是"没有可用账号"）也原样传回。唯一没验到的仍是真账号的成功回复：沙箱连不上 muse.ai，和本项目其他地方的边界相同。
