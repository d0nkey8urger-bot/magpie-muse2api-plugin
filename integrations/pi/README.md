# 在 Pi Agent 里用 Muse

[Pi Agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 的 `models.json` 原生支持自定义 OpenAI 兼容供应商，所以这个适配**不用写插件**——和 DeepSeek Harness 那份同理：把本目录的 provider 片段合并进 pi 的配置就行。前提和别处一样：muse2api 实例先跑起来（本仓库插件的一键托管，或你自己跑）。

## 接入（合并一个片段）

打开 pi 的 `models.json`——默认在 `~/.pi/agent/models.json`（用 `PI_CODING_AGENT_DIR` 改过 agent 目录的话，是 `<agent-dir>/models.json`）——把本目录 [`models.muse2api.json`](models.muse2api.json) 里的 `muse2api` 条目合并进它的 `providers` 下面；文件还不存在或没有其他供应商时，整个片段就是完整的 `models.json`。

合并前改一处：片段里 `apiKey` 是 `"!node /path/to/.../print-key.mjs"`，把路径换成**你这份仓库克隆里** [`print-key.mjs`](print-key.mjs) 的绝对路径。pi 每次请求前会执行这条命令、拿它的输出当 key，所以真实的 key 不落进 `models.json`——脚本读的是托管目录 `~/.muse2api-plugin/.env`（托管目录改过位置就设环境变量 `MUSE2API_PLUGIN_HOME`，或给命令加 `--home <目录>`）。

## 使用

```sh
pi --provider muse2api --model muse-spark
pi -p --provider muse2api --model muse-spark "列出当前目录下所有文件"
```

想让它成为默认，在 pi 的 `settings.json` 里把默认 provider/model 设成 `muse2api`/`muse-spark` 即可（或在交互界面里选一次，pi 会记住）。

片段里两个数字先说清：`contextWindow: 128000` 和 `maxTokens: 8192` 是保守的占位值——muse.ai 不通过接口公布 muse-spark 真实的上下文与输出上限，这两个数只是让 pi 的上下文管理有个依据，觉得不够用可以自己调大。

## 先说清的短板

- pi 的 agent 循环很吃工具调用，而 muse2api 的 tool call 是从网页模型的回复里**模拟**出来的——普通活能干，复杂工具组合是最先出问题的地方，和在其他 agent 里一样。
- 实例跑在别的地址（不是本机 18610）的话，改片段里的 `baseUrl` 一处即可。

> 核对方式：片段的字段形状对照 pi 实际在用的 `models.json`（一个真实 provider 条目）逐项核过；并且已在开发沙箱里真机验过——用只含这份片段的临时 agent 目录实跑 `pi -p --provider muse2api --model muse-spark`，请求真打到了 muse2api 实例（`POST /v1/chat/completions`），实例的回复（沙箱里的实例没有 Muse 账号，回的是"没有可用账号"）也原样经 pi 传回，`apiKey` 的命令取 key 一并验通。唯一没验到的仍是真账号的成功回复：沙箱连不上 muse.ai，和本项目其他地方的边界相同。
