#!/usr/bin/env node
// Prints ccswitch:// one-click import links that add a muse2api
// instance to CC Switch (https://github.com/farion1231/cc-switch)
// as a provider — for Codex, OpenCode, or Claude Code.
//
// The key is read from the plugin's managed install
// (~/.muse2api-plugin/.env — the folder the butler setup created),
// or pass --key for an instance you run yourself. Nothing is sent
// anywhere: the link is printed, you open it, CC Switch shows its
// own confirmation dialog before importing.
//
//   node make-link.mjs                 # the Codex link
//   node make-link.mjs --app all       # codex + opencode + claude
//   node make-link.mjs --key m2a_... --base http://127.0.0.1:18610/v1

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const base = opt("base", "http://127.0.0.1:18610/v1").replace(/\/+$/, "")
const home = opt("home", process.env.MUSE2API_PLUGIN_HOME || join(homedir(), ".muse2api-plugin"))

let key = opt("key", "")
if (!key) {
  try {
    key = readFileSync(join(home, ".env"), "utf8").match(/^MUSE2API_KEY=(\S+)$/m)?.[1] ?? ""
  } catch {}
}
if (!key || key === "m2a_your_secret_admin_key_here") {
  console.error(
    `No MUSE2API_KEY found in ${join(home, ".env")} — run the plugin's automatic setup first (magpie plugin login muse2api), or pass --key for your own instance.`,
  )
  process.exit(1)
}

function link(app) {
  const p = new URLSearchParams({
    resource: "provider",
    app,
    name: "Muse (muse2api)",
    homepage: "https://muse.ai",
    endpoint: base,
    apiKey: key,
    model: "muse-spark",
    enabled: "true",
    notes: "Muse (muse.ai) through a local muse2api instance",
  })
  if (app === "claude") {
    // the instance has the one chat model; every tier maps to it
    p.set("haikuModel", "muse-spark")
    p.set("sonnetModel", "muse-spark")
    p.set("opusModel", "muse-spark")
  }
  return `ccswitch://v1/import?${p}`
}

const wanted = opt("app", "codex")
const apps = wanted === "all" ? ["codex", "opencode", "claude"] : [wanted]
for (const app of apps) {
  console.log(`# ${app}\n${link(app)}\n`)
  if (app === "claude")
    console.log(
      "Note: the Claude Code entry imports as a direct provider, but Claude Code speaks the Anthropic protocol and muse2api speaks OpenAI's — in CC Switch, put this provider on the routing (proxy) mode with the upstream format set to Responses, or it cannot answer. The Codex and OpenCode entries work as imported.\n",
    )
}
