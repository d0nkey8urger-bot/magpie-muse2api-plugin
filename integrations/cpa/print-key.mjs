#!/usr/bin/env node
// Prints the key of the plugin's managed muse2api instance — and
// nothing else. This one is for pasting: CPA's config.yaml has no
// environment-variable indirection for upstream keys, so the key
// is pasted into the config by hand. For an instance you run yourself,
// pass --key instead.
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const home = opt("home", process.env.MUSE2API_PLUGIN_HOME || join(homedir(), ".muse2api-plugin"))
let key = opt("key", "")
if (!key) {
  try {
    key = readFileSync(join(home, ".env"), "utf8").match(/^MUSE2API_KEY=(\S+)$/m)?.[1] ?? ""
  } catch {}
}
if (!key || key === "m2a_your_secret_admin_key_here") {
  console.error(`No MUSE2API_KEY found in ${join(home, ".env")} — run the automatic setup first (magpie plugin login muse2api), or pass --key.`)
  process.exit(1)
}
console.log(key)
