# 在 CLIProxyAPI（CPA）里用 Muse

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（社区里常简称 CPA）是一个自托管网关：把各家订阅和 API 统一成一个 OpenAI 兼容出口，供 Codex、OpenCode 等客户端共用——和 magpie 是同一个岗位，区别是它是个无头服务程序，适合常驻在桌面或服务器上。muse2api 在它眼里就是一个 OpenAI 兼容上游，配置级接入，不用插件。前提照旧：实例先跑起来（本仓库插件的一键托管，或你自己跑）。

## 接入步骤

1. 取出实例的 key（托管实例）：

   ```sh
   node integrations/cpa/print-key.mjs
   ```

2. 把本目录的 [`config.muse2api.yml`](config.muse2api.yml) 里的 `openai-compatibility` 条目合并进 CPA 的 `config.yaml`（已有 `api-keys:` 根就并进去，不要出现两个根），把 `PASTE_MUSE2API_KEY_HERE` 换成上一步的 key。CPA 会监视配置文件并热加载，改完不用重启。

3. 确认 `config.yaml` 里 `access.api-keys` 下有至少一个你自己的客户端 key（那是客户端连 CPA 用的，和上游 key 是两回事）。

4. 客户端指向 CPA：

   | 字段 | 值 |
   |---|---|
   | Base URL | `http://127.0.0.1:8317/v1` |
   | API key | 你在 `access.api-keys` 里设的那个 |
   | Model | `muse-spark` |

## 先说清的两件事

- **key 是明文躺在 config.yaml 里的。** CPA 的配置没有环境变量代读这一层（dsh、pi 那两份能做到 key 不落文件，这里做不到），所以这份配置文件别外传、别提交进公开仓库，权限收紧到自己可读。
- **版本对齐**：这份片段按 CPA v8 的版式写的（`config-version: 8`，上游在 `api-keys` 根下）。CPA 迭代很快，字段位置跨版本挪过位置——你手头版本的 `config.example.yaml` 才是准绳，对不上时照它调整层级，内容不变。

其余的脾气它都和 muse2api 合得来：比如给兼容上游发请求时，它默认用的就是 `max_tokens`（`use-max-completion-tokens` 默认关），不用额外调。老短板也还是那一条：它的客户端多是 agent，agent 吃工具调用，而 muse2api 的 tool call 是模拟出来的，复杂工具组合最先出问题。

> 核对方式：字段与层级按 CPA v8.0.25 的 `config.example.yaml` 核对；并且已在开发沙箱里真机验过——官方二进制配上这份配置启动后，用客户端 key 拉 `/v1/models` 能看到 `muse-spark`（归属标着 muse2api），一次真实对话请求穿过 CPA 打到了 muse2api 实例，实例的回复（沙箱里的实例没有 Muse 账号，回的是"没有可用账号"）原样传回。唯一没验到的仍是真账号的成功回复：沙箱连不上 muse.ai，和本项目其他地方的边界相同。
