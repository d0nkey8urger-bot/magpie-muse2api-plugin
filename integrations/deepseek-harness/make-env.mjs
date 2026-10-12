#!/usr/bin/env node
// Prints the shell line that gives DeepSeek Harness (dsh) the key of
// the plugin's managed muse2api instance:
//
//   eval "$(node make-env.mjs)"        # then start dsh in this shell
//   dsh web
//
// The dsh provider snippet (cordis.patch.yml next to this script)
// reads its credential from the MUSE2API_KEY environment variable,
// so nothing secret is written into dsh's own config files. For an
// instance you run yourself, pass --key instead.
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
console.log(`export MUSE2API_KEY=${key}`)
