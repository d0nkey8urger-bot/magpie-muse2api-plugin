# Muse (muse2api)

Use [Muse](https://muse.ai) (Meta's assistant) as a model in Codex, OpenCode and the other agents magpie drives — through a [muse2api](https://github.com/czg86389-hub/muse2api) instance you run yourself.

muse2api turns the muse.ai web app into an OpenAI-compatible API: it drives the site from a local Chromium, keeps the session alive, and serves chat, image and video endpoints. This plugin is the adapter between magpie and that instance — it declares the model, carries the instance's address and key, reads its live model list, and shows its account pool on magpie's usage card. The Muse account itself is imported into the instance — by muse2api's own tool, or by this plugin's import method, which hands the session cookies straight to your instance and nowhere else.

> muse2api is an unofficial bridge that drives muse.ai through its web UI. Requests use your own Muse account's web quota, and the project's own caveats (terms of service, account risk) apply — whether it fits how you use your account is your call.

## This edition — the full one, in its own repo

This is the standalone, full-featured edition of the plugin: automatic setup, account import, guided connect and the plain key method.

A trimmed edition — the adapter alone — is [proposed to the magpie-community plugins repo](https://github.com/magpie-community/plugins/pull/95). That repo's harm rules do not allow a plugin to read sign-in cookies or to start processes, and the two convenience methods here do exactly those things, on your own machine and for your own instance: the automatic setup downloads muse2api from its GitHub repo and starts it, and the import passes your muse.ai session cookies to the instance address in play — which is why the guided methods check that address and say whose it is before anything is sent. Both editions use the provider id `muse2api`, so install one or the other, not both.

Install from here (not on npm):

```sh
git clone https://github.com/d0nkey8urger-bot/magpie-muse2api-plugin
magpie plugin add ./magpie-muse2api-plugin
magpie plugin login muse2api
```

or download a release zip, unzip it, and `magpie plugin add` the unzipped folder. In OpenCode without magpie, put the folder where OpenCode loads local plugins from and run `opencode auth login`.

## The short way — let the plugin set it up

```sh
magpie plugin login muse2api
```

Pick **Set up muse2api for me (automatic)** — the first method. The plugin then does steps 0–2 below by itself:

1. installs muse2api into `~/.muse2api-plugin` — a pinned copy ships inside the plugin (`vendor/muse2api`), so there is no download; a GitHub clone is only a fallback if that copy is missing,
2. invents the instance's `MUSE2API_KEY` and writes it into that install's `.env`,
3. starts the instance — with Docker if Docker is running, otherwise with a Python venv it creates — **detached, so it keeps serving after magpie closes**,
4. opens the sign-in window and imports your Muse account, as in step 1.

Your only step is signing in to muse.ai in the window. Later sign-ins resume the same install and instance; nothing is downloaded or started twice.

Two habits keep a managed setup honest afterwards. A sign-in counts as successful only once Muse has really answered a tiny test request through the instance — an imported account that cannot answer fails the sign-in with the instance's own reason, not later as a dead provider. And if the managed instance stops (a reboot, a crash), the next agent run quietly starts it again; a pool whose accounts have all expired goes back through the import window instead of reporting success.

It needs: Docker running **or** Python 3.10+, and a Chrome/Edge/Brave/Chromium for the sign-in window. (The GitHub fallback, if it is ever needed, needs git or tar/unzip and a network that reaches github.com.) Set `MUSE2API_PLUGIN_HOME` to put the managed install somewhere else.

Managing it afterwards: the instance's log is `~/.muse2api-plugin/muse2api.log`; stop it with the pid in `~/.muse2api-plugin/muse2api.pid` (or `docker compose down` in that folder, if it used Docker); delete the folder to remove it entirely. An instance you run yourself is never touched — if something already answers at the instance's address and it isn't the managed one, this method says so and steps aside.

## Integrations

- **CC Switch** — use Muse in the Codex / OpenCode / Claude Code setups CC Switch manages: one-click import links (with your managed key filled in by a helper script) under [`integrations/cc-switch/`](integrations/cc-switch/README.md).
- **DeepSeek Harness (dsh)** — Muse as a custom provider, no plugin needed: UI steps, a ready `cordis.patch.yml`, and a key helper under [`integrations/deepseek-harness/`](integrations/deepseek-harness/README.md).
- **Pi Agent** — Muse as a custom provider in `models.json`, no plugin needed: a merge-ready provider fragment whose key is fetched by command, never written into the file, under [`integrations/pi/`](integrations/pi/README.md).
- **CLIProxyAPI (CPA)** — Muse as an OpenAI-compatibility upstream in CPA's `config.yaml`: a merge-ready fragment and a key helper under [`integrations/cpa/`](integrations/cpa/README.md).

## Doing it yourself instead

### Step 0 — run muse2api

On the machine your agents run on (or any machine they can reach):

```sh
git clone https://github.com/czg86389-hub/muse2api
cd muse2api
cp .env.example .env   # set MUSE2API_KEY to a key of your own in .env
docker compose up -d
```

No Docker? muse2api also runs bare on Python 3.12 with a local Chrome — see its README. Either way it listens on `http://127.0.0.1:18610` by default, and its admin page is at `http://127.0.0.1:18610/admin?key=<your MUSE2API_KEY>`.

### Step 1 — give the instance your Muse account

You can skip this step: the automatic setup above, and the "Connect and import" sign-in method in step 2, both run this same flow from inside magpie. The manual way, in the muse2api folder:

```sh
python3 tools/get_muse_cookie.py
```

in the muse2api folder. It opens a throwaway Chrome window; sign in to muse.ai there and it imports the session by itself — no browser extension, no Tampermonkey script, nothing pasted into a chat. (The admin page offers the other import methods too.) Sessions renew themselves, so an instance typically keeps answering for weeks unattended.

Check it worked: the admin page lists your account, and

```sh
curl http://127.0.0.1:18610/v1/models -H "Authorization: Bearer <your MUSE2API_KEY>"
```

lists `muse-spark`.

### Step 2 — connect magpie to the instance

Install this plugin, then sign in:

```sh
magpie plugin login muse2api
```

Pick **Connect to a muse2api instance**. It asks for the instance address (the default `http://127.0.0.1:18610/v1` is prefilled) and its `MUSE2API_KEY`, and **checks both against the live instance before saving anything**:

- a dead address fails there — *"Couldn't reach a muse2api instance…"*
- a wrong key fails there — *"The instance … refused that key…"*
- an instance with no Muse account yet still connects, and tells you to finish step 1

Or pick **Connect and import your Muse account**: same two prompts, same checks — then a throwaway Chrome window opens on muse.ai, you sign in there as you normally would, and the account is imported into your instance automatically when the sign-in lands (keep the window open until the sign-in completes, up to 5 minutes). This needs a Chrome, Edge, Brave or Chromium on the machine; point `MUSE2API_CHROME` at one if it lives somewhere unusual. The session cookies are read through the browser's DevTools protocol — they are HttpOnly, so no page script can read them — and are handed only to your own instance.

The plain key method is also offered, if you would rather not be checked. An instance at a non-default address can also be named by the provider's `baseURL` option or the `MUSE2API_BASE_URL` environment variable; the address saved at connect wins over both.

In OpenCode without magpie, add `"@magpie-community/opencode-muse2api-auth"` to the `plugin` array in `opencode.json`, then `opencode auth login` and pick muse2api. Either way the key is kept in the tool's own auth store, like every other package's sign-in.

### Step 3 — use it

```sh
magpie codex muse2api/muse-spark
```

or pick `muse2api/muse-spark` in any agent magpie configures. Verify the whole chain any time with

```sh
magpie provider test muse2api
```

That sends one real (tiny) request through magpie → this plugin → your instance → muse.ai.

magpie's usage card (`magpie quota`) shows the instance's account pool — how many Muse accounts it holds and how many are ready — read live from the instance. The instance serves a bounded number of concurrent generations (2 by default), so the package caps concurrency at 2 to match.

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| `Couldn't reach a muse2api instance` at sign-in | nothing is listening at that address | start the instance (step 0); check the address and port |
| `refused that key` at sign-in | the key isn't the instance's `MUSE2API_KEY` | copy it from the instance's `.env`, exactly |
| `没有可用账号` ("no accounts available") from a test or an agent | the chain works; the instance has no usable Muse account | finish step 1, or re-import — the session may have expired |
| `401` from an agent but sign-in worked | the instance was restarted with a different key | sign in again so magpie holds the current key |
| `No Chrome, Edge, Brave or Chromium found` during import | the import window needs a Chromium browser | install Chrome, or set `MUSE2API_CHROME` to a browser executable |
| `The sign-in window was closed…` during import | the window went away before the sign-in landed | sign in again and keep the window open until magpie says it finished |
| `Couldn't download muse2api` during automatic setup | no git and no working tar/unzip, or github.com unreachable | install git, check the network, or run muse2api yourself (steps above) |
| `no Docker … and no Python 3.10+` during automatic setup | nothing on the machine can run the instance | install Python from python.org or start Docker Desktop, then sign in again |
| `The managed instance didn't answer` | the hosted instance failed to start | read `~/.muse2api-plugin/muse2api.log` |
| model list shows only `muse-spark` | that's the instance's chat model | `muse-image` / `muse-video` are media endpoints, not chat models, and are deliberately not offered to agents |

Good to know: muse.ai's web API returns no structured tool calls, so muse2api reconstructs them from the model's reply. Ordinary agent work holds up; very exotic tool schemas are where it can fray — if an agent misbehaves on one specific tool, that layer is why.

## Credits

[muse2api](https://github.com/czg86389-hub/muse2api) by czg86389-hub and its contributors (MIT) — the service this plugin adapts. The account-import flow is ported from the project's `tools/get_muse_cookie.py` (MIT, © the muse2api authors); this package's own code is MIT as well.

## Development

```sh
bun test    # in this folder
```

The bundled muse2api under `vendor/muse2api` is pinned — its source commit and license are in its `VENDOR.md`; bump it deliberately, in its own commit, when upstream moves.
