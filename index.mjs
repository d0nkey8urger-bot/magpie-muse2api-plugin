// Muse (muse.ai) for OpenCode and magpie, through a muse2api instance
// you run yourself.
//
// muse2api (https://github.com/czg86389-hub/muse2api) turns the muse.ai
// web app into an OpenAI-compatible API served from your own machine.
// That instance does all the work the other packages here do in their
// loaders — driving the site, keeping the sign-in alive — so this
// plugin is an adapter: it tells OpenCode / magpie where the instance
// lives, which key it takes and which models it serves.
//
// Signing in is connecting to an instance: the guided methods ask for
// the instance's address and its MUSE2API_KEY, and check both against
// the live instance before anything is saved — a wrong address or key
// fails there, in words, not later as a dead provider. The second
// method also imports the Muse account: it opens a throwaway Chrome
// window for the user to sign in to muse.ai in, reads the session
// cookies through the browser's DevTools protocol (they are HttpOnly;
// no page script can read them) and hands them to the instance. That
// flow is ported from muse2api's own tools/get_muse_cookie.py
// (MIT, © the muse2api authors). No credential is ever typed into
// this plugin, and the cookies go only to the user's own instance.
//
// One method needs none of that: it sets the instance up itself
// (the butler, below) — downloads muse2api, starts it, and only
// then asks the user for the one thing no method can do for them,
// the muse.ai sign-in in a browser window.

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises"
import { createServer as createNetServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { delimiter, isAbsolute, join } from "node:path"

const ID = "muse2api"
const CHAT = "@ai-sdk/openai-compatible"
const DEFAULT_BASE = "http://127.0.0.1:18610/v1"

// The instance's own list (its GET /v1/models) has three capabilities:
// muse-spark for chat and code, muse-image and muse-video for media.
// Only muse-spark is a chat model an agent can be given. The list is
// re-read from the instance when it answers (the models hook below);
// this static copy is what an agent sees before sign-in and whenever
// the instance does not answer. muse.ai routes behind its web UI and
// publishes no context size, so the limits stay 0 (not said), as the
// other packages leave what a vendor does not say.
const MODELS = [{ id: "muse-spark", name: "Muse Spark" }]
const MEDIA_ID = /image|video/

const PROMPTS = [
  { type: "text", key: "base", message: "Your muse2api instance address", placeholder: DEFAULT_BASE },
  { type: "text", key: "key", message: "Its MUSE2API_KEY", placeholder: "m2a_…" },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Where the instance lives, best source first: the address saved with
// the sign-in (the guided method puts it in the auth metadata), the
// provider's baseURL option, MUSE2API_BASE_URL, the default.
function baseURL(provider, auth) {
  const fromAuth = auth?.metadata?.base
  const fromOptions = provider?.options?.baseURL ?? provider?.options?.baseUrl
  const raw = fromAuth || fromOptions || process.env.MUSE2API_BASE_URL || DEFAULT_BASE
  return String(raw).replace(/\/+$/, "")
}

// The instance's admin endpoints live at its root, not under /v1.
function adminURL(base, path) {
  return base.replace(/\/v1$/, "") + path
}

function modelEntry(m) {
  return {
    name: m.name,
    limit: { context: 0, output: 0 },
    // the instance's chat endpoint hands tool calls back in OpenAI's
    // shape (it parses them out of the web model's reply), so an
    // agent's tools work as they do on a native endpoint
    tool_call: true,
  }
}

async function ask(base, key, url, timeoutMs = 10_000) {
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    throw new Error(`Couldn't reach a muse2api instance at ${base} — is it running? (${e?.cause?.message ?? e.message})`)
  }
}

// probe checks an address and key against the live instance and reads
// its account pool. A wrong key and a dead address are different
// failures and are said differently; a pool that cannot be read is
// not fatal — the key was accepted, which is what sign-in promises.
async function probe(base, key) {
  const res = await ask(base, key, `${base}/models`)
  if (res.status === 401 || res.status === 403)
    throw new Error(`The instance at ${base} refused that key — it isn't the MUSE2API_KEY the instance was started with (see its .env).`)
  if (!res.ok) throw new Error(`The instance at ${base} answered /v1/models with ${res.status} — is that really a muse2api instance?`)
  try {
    const s = await ask(base, key, adminURL(base, "/admin/status"))
    if (s.ok) return (await s.json())?.stats ?? null
  } catch {}
  return null
}

// The two prompts, parsed and said plainly when wrong — shared by the
// guided methods.
function parseInputs(inputs) {
  const base = String(inputs?.base ?? "").trim().replace(/\/+$/, "") || DEFAULT_BASE
  const key = String(inputs?.key ?? "").trim()
  let u
  try {
    u = new URL(base)
  } catch {
    throw new Error(`"${base}" isn't an address — the instance address looks like ${DEFAULT_BASE}`)
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`"${base}" isn't an http(s) address — the instance address looks like ${DEFAULT_BASE}`)
  if (!key) throw new Error("Paste the instance's MUSE2API_KEY — it's the MUSE2API_KEY line in the .env the instance was started with.")
  return { base, key }
}

// connect is the guided sign-in: the two prompts, checked live. The
// callback's result is what magpie keeps: an api sign-in whose key is
// the instance's and whose metadata.base is where it lives, as the
// other packages' browser sign-ins land.
async function connect(inputs) {
  const { base, key } = parseInputs(inputs)
  const pool = await probe(base, key)
  const ready = pool ? `${pool.healthy ?? 0} of ${pool.enabled ?? pool.total ?? 0} Muse accounts ready` : null
  return {
    url: "",
    instructions:
      pool && (pool.total ?? 0) === 0
        ? `Connected to the instance at ${base}, but it has no Muse account yet — sign in again with "Connect and import your Muse account" and the account is imported for you, then this provider can answer.`
        : `Connected to the instance at ${base}${ready ? `: ${ready}` : ""}.`,
    method: "auto",
    callback: async () => ({ type: "success", provider: ID, key, metadata: { base } }),
  }
}

// ---- importing the Muse account --------------------------------------
//
// Ported from muse2api's tools/get_muse_cookie.py (MIT, © the
// muse2api authors), which does this as a standalone script: a
// throwaway Chrome window on a temporary profile, the user signing in
// to muse.ai in it, the session cookies read over the DevTools
// protocol and uploaded to the instance's POST /admin/accounts.
// Here it runs inside the sign-in instead, so the account arrives in
// the same step that connects the instance.

const SITE = "https://muse.ai/"
// the four cookies a muse.ai session stands on, as the instance
// names them; without all four the import is not a sign-in
const ESSENTIAL = ["hatch_sess", "hatch_gw", "hatch_vml", "hatch_native_auth_device"]
const IMPORT_TIMEOUT_MS = 300_000

// Where a Chromium browser may live, best first. The original also
// reads the Windows registry's App Paths, which no standard JS
// runtime can; the standard install locations below plus the
// MUSE2API_CHROME override cover what the registry would find.
function chromeCandidates(platform = process.platform, env = process.env) {
  if (env.MUSE2API_CHROME) return [env.MUSE2API_CHROME]
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA, "C:\\Program Files", "C:\\Program Files (x86)"].filter(Boolean)
    const rels = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "Chromium\\Application\\chrome.exe",
    ]
    return [...new Set(roots.flatMap((r) => rels.map((p) => join(r, p))))]
  }
  if (platform === "darwin")
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]
}

function whichSync(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue
    const p = join(dir, name)
    if (existsSync(p)) return p
    if (process.platform === "win32" && existsSync(`${p}.exe`)) return `${p}.exe`
  }
  return null
}

function findChrome() {
  for (const c of chromeCandidates()) {
    if (!c) continue
    if (isAbsolute(c)) {
      if (existsSync(c)) return c
    } else {
      const hit = whichSync(c)
      if (hit) return hit
    }
  }
  return null
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.once("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function launchChrome(chrome, port) {
  const profile = await mkdtemp(join(tmpdir(), "muse2api-cookie-"))
  const proc = spawn(
    chrome,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      // restricted environments (containers, CI) fail Chrome's own
      // sandbox init and the debug port then never comes up; the
      // original passes these too, and they are inert on a desktop
      "--no-sandbox",
      "--disable-gpu",
      "--new-window",
      SITE,
    ],
    { stdio: "ignore" },
  )
  // a spawn failure surfaces as this event; the debug-port wait below
  // turns it into words, so it must not crash the plugin first
  proc.on?.("error", () => {})
  return { proc, profile }
}

// waitForCdp polls the browser's /json/version until the DevTools
// websocket address is there, as the original does.
async function waitForCdp(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2_000) })
      if (r.ok) {
        const j = await r.json()
        if (j?.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
      }
    } catch (e) {
      last = e
    }
    await sleep(500)
  }
  throw new Error(`the browser's debug port never came up (${last?.message ?? "no answer"})`)
}

// One DevTools call over the browser-level websocket. The original
// hand-rolls a WebSocket client because Python's standard library has
// none; this runtime has one built in.
function cdpCall(wsUrl, method, params = {}, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      try {
        ws.close()
      } catch {}
      reject(new Error(`CDP ${method} timed out`))
    }, timeoutMs)
    const done = (fn, v) => {
      clearTimeout(timer)
      try {
        ws.close()
      } catch {}
      fn(v)
    }
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.addEventListener("message", (ev) => {
      let msg
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (msg.id !== 1) return
      if (msg.error) done(reject, new Error(`CDP ${method}: ${msg.error.message ?? "error"}`))
      else done(resolve, msg.result ?? {})
    })
    ws.addEventListener("error", () => done(reject, new Error(`CDP ${method}: the browser connection failed`)))
    ws.addEventListener("close", () => done(reject, new Error(`CDP ${method}: the browser closed the connection`)))
  })
}

// pickCookies keeps the muse.ai cookies out of the browser's whole
// store, in the shape the instance's account pool stores.
function pickCookies(list) {
  const out = {}
  for (const c of list ?? []) {
    const domain = String(c?.domain ?? "").replace(/^\./, "")
    if (!domain.includes("muse.ai")) continue
    if (!c?.name) continue
    const exp = Number.isFinite(+c.expires) ? Math.trunc(+c.expires) : -1
    out[c.name] = { value: String(c.value ?? ""), expires: exp, httpOnly: !!c.httpOnly }
  }
  return out
}

function defaultLabel() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, "0")
  return `muse-${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

// uploadCookies hands the session to the instance, in the payload
// shape its POST /admin/accounts takes (the original's upload).
async function uploadCookies(base, key, label, got) {
  const payload = {
    label,
    cookies: Object.fromEntries(Object.entries(got).map(([n, c]) => [n, c.value])),
    expires: Object.fromEntries(
      Object.entries(got)
        .filter(([, c]) => c.expires > 0)
        .map(([n, c]) => [n, c.expires]),
    ),
  }
  let res
  try {
    res = await fetch(adminURL(base, "/admin/accounts"), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    throw new Error(`Couldn't reach a muse2api instance at ${base} — is it running? (${e?.cause?.message ?? e.message})`)
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300)
    throw new Error(`The instance at ${base} refused the imported account (HTTP ${res.status})${detail ? `: ${detail}` : ""}`)
  }
  const j = await res.json().catch(() => null)
  return j?.added?.[0] ?? null
}

// importFlow runs the import: find a browser, open the window, wait
// for the sign-in to land in the cookie store, upload it. Every
// failure is a { type: "failed" } with the words the original gives
// its user. The browser-touching steps are parameters so the flow
// can be tested without a browser.
async function importFlow(base, key, deps = {}) {
  const find = deps.findChrome ?? findChrome
  const launch = deps.launch ?? launchChrome
  const wait = deps.waitForCdp ?? waitForCdp
  const getCookies =
    deps.getCookies ?? ((wsUrl) => cdpCall(wsUrl, "Storage.getCookies", {}).then((r) => r.cookies ?? []))
  const upload = deps.upload ?? uploadCookies
  const timeoutMs = deps.timeoutMs ?? IMPORT_TIMEOUT_MS
  const pollMs = deps.pollMs ?? 2_000

  const chrome = find()
  if (!chrome)
    return {
      type: "failed",
      error:
        "No Chrome, Edge, Brave or Chromium found on this machine — install Chrome, or set MUSE2API_CHROME to a Chromium browser's executable, then sign in again.",
    }
  const port = await (deps.freePort ?? freePort)()
  let proc
  let profile
  try {
    ;({ proc, profile } = await launch(chrome, port))
    let wsUrl
    try {
      wsUrl = await wait(port)
    } catch {
      return {
        type: "failed",
        error:
          "The browser window opened but its debug port never came up. If your everyday Chrome is running, quit it completely and sign in again.",
      }
    }
    const deadline = Date.now() + timeoutMs
    let got = {}
    const landed = () => ESSENTIAL.every((n) => got[n]?.value)
    while (Date.now() < deadline) {
      if (proc && (proc.exitCode !== null || proc.killed))
        return {
          type: "failed",
          error: "The sign-in window was closed before the muse.ai sign-in landed — sign in again and keep the window open until it finishes.",
        }
      try {
        got = pickCookies(await getCookies(wsUrl))
      } catch {
        // a read that fails mid-poll is retried, as the original does
      }
      if (landed()) break
      await sleep(pollMs)
    }
    if (!landed())
      return {
        type: "failed",
        error: `Timed out waiting for the muse.ai sign-in (got ${ESSENTIAL.filter((n) => got[n]?.value).length} of ${ESSENTIAL.length} session cookies). Sign in again and complete the sign-in in the window.`,
      }
    const label = deps.label ?? defaultLabel()
    try {
      await upload(base, key, label, got)
    } catch (e) {
      return { type: "failed", error: e.message }
    }
    return { type: "success", provider: ID, key, metadata: { base, account: label } }
  } finally {
    try {
      proc?.kill?.()
    } catch {}
    if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

// importSignIn is the second guided method: connect's checks, then
// the import itself runs in the callback, while the instructions
// tell the user what the window is for.
async function importSignIn(inputs) {
  const { base, key } = parseInputs(inputs)
  await probe(base, key)
  return {
    url: "",
    instructions:
      "A Chrome window opens on muse.ai — sign in there as you normally would. When the sign-in lands, the account is imported into your muse2api instance and this sign-in completes. Keep the window open until then (up to 5 minutes).",
    method: "auto",
    callback: () => importFlow(base, key),
  }
}

// ---- the butler: a managed muse2api, set up for the user -------------
//
// The first sign-in method, for everyone who does not want to run a
// service themselves: the plugin installs muse2api into a folder of
// its own, invents the instance's key (written into that install's
// .env before its first start, so the key is the plugin's to know —
// nothing is ever read out of an instance the user runs themselves),
// starts it detached so it keeps serving after magpie closes, and
// finishes with the account import above. The user's only step is
// the muse.ai sign-in in the window, as everywhere else here.

const REPO = "https://github.com/czg86389-hub/muse2api"
const REPO_ZIP = `${REPO}/archive/refs/heads/main.zip`

function managedDir(env = process.env) {
  return env.MUSE2API_PLUGIN_HOME || join(homedir(), ".muse2api-plugin")
}

// exec0 runs a command to completion and reports, never throws: a
// missing git or docker is a finding, not a crash.
function exec0(cmd, args, { cwd, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    let out = ""
    let p
    try {
      p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    } catch {
      return resolve({ ok: false, out })
    }
    const timer = setTimeout(() => {
      try {
        p.kill()
      } catch {}
    }, timeoutMs)
    const take = (d) => {
      if (out.length < 200_000) out += d
    }
    p.stdout?.on("data", take)
    p.stderr?.on("data", take)
    p.on?.("error", () => {
      clearTimeout(timer)
      resolve({ ok: false, out })
    })
    p.on?.("close", (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, out })
    })
  })
}

function genKey() {
  // the instance's own shape: m2a_ plus 24 random bytes as hex
  return `m2a_${randomBytes(24).toString("hex")}`
}

async function isInstalled(dir) {
  return existsSync(join(dir, "app.py"))
}

// install fetches muse2api into the managed folder: a git clone
// first, as the project's README prescribes; the source archive
// (system tar, or unzip) where there is no git.
async function install(dir) {
  await mkdir(dir, { recursive: true })
  const g = await exec0("git", ["clone", "--depth", "1", REPO, dir], { timeoutMs: 300_000 })
  if (g.ok && (await isInstalled(dir))) return true
  const tmp = await mkdtemp(join(tmpdir(), "muse2api-dl-"))
  try {
    const zip = join(tmp, "repo.zip")
    const res = await fetch(REPO_ZIP)
    if (!res.ok) return false
    await writeFile(zip, Buffer.from(await res.arrayBuffer()))
    let x = await exec0("tar", ["-xf", zip, "-C", tmp], { timeoutMs: 120_000 })
    if (!x.ok) x = await exec0("unzip", ["-q", zip, "-d", tmp], { timeoutMs: 120_000 })
    const inner = join(tmp, "muse2api-main")
    if (!x.ok || !existsSync(join(inner, "app.py"))) return false
    for (const name of await readdir(inner)) await rename(join(inner, name), join(dir, name))
    return isInstalled(dir)
  } catch {
    return false
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

// The managed install's key lives in its own .env, where the butler
// put it — reading it back reads the plugin's own file, which is
// what makes a later run able to resume its own instance.
function readManagedKey(dir) {
  try {
    const m = readFileSync(join(dir, ".env"), "utf8").match(/^MUSE2API_KEY=(\S+)$/m)
    return m?.[1] && m[1] !== "m2a_your_secret_admin_key_here" ? m[1] : null
  } catch {
    return null
  }
}

async function ensureManagedKey(dir) {
  const existing = readManagedKey(dir)
  if (existing) return existing
  const key = genKey()
  const envPath = join(dir, ".env")
  let text = ""
  try {
    text = readFileSync(envPath, "utf8")
  } catch {}
  if (/^MUSE2API_KEY=.*$/m.test(text)) text = text.replace(/^MUSE2API_KEY=.*$/m, `MUSE2API_KEY=${key}`)
  else text = `${text}${text && !text.endsWith("\n") ? "\n" : ""}MUSE2API_KEY=${key}\n`
  await writeFile(envPath, text)
  return key
}

async function dockerReady() {
  if (!(await exec0("docker", ["--version"], { timeoutMs: 10_000 })).ok) return false
  return (await exec0("docker", ["info"], { timeoutMs: 20_000 })).ok
}

async function findPython() {
  for (const cmd of process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"]) {
    const v = await exec0(cmd, ["--version"], { timeoutMs: 10_000 })
    if (v.ok && /Python 3\.(1[0-9]|[2-9]\d)/.test(v.out)) return cmd
  }
  return null
}

async function startDocker(dir) {
  // the project's compose file builds the image on first run, which
  // can take minutes; its restart policy then keeps it serving
  return (await exec0("docker", ["compose", "up", "-d"], { cwd: dir, timeoutMs: 900_000 })).ok
}

// requirements.txt with one deviation: uvicorn without its
// [standard] extras on Windows, whose uvloop has no Windows wheels —
// the extras are speedups, the service runs the same without them
const PIP_DEPS = [
  "fastapi>=0.115",
  process.platform === "win32" ? "uvicorn>=0.32" : "uvicorn[standard]>=0.32",
  "pydantic>=2.9",
  "requests>=2.32",
  "websocket-client>=1.8",
  "python-multipart>=0.0.9",
]

async function startPython(dir, python) {
  const venv = join(dir, "venv")
  const venvPy = process.platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python")
  if (!existsSync(venvPy)) {
    if (!(await exec0(python, ["-m", "venv", "venv"], { cwd: dir, timeoutMs: 300_000 })).ok) return false
    if (!(await exec0(venvPy, ["-m", "pip", "install", ...PIP_DEPS], { cwd: dir, timeoutMs: 900_000 })).ok) return false
  }
  const logFd = openSync(join(dir, "muse2api.log"), "a")
  const proc = spawn(venvPy, ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "18610"], {
    cwd: dir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  })
  proc.on?.("error", () => {})
  try {
    writeFileSync(join(dir, "muse2api.pid"), String(proc.pid))
  } catch {}
  proc.unref?.()
  closeSync(logFd)
  return true
}

// waitUp polls until the managed instance answers with our key.
async function waitUp(base, key, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await ask(base, key, `${base}/models`, 3_000)
      if (r.ok) return "up"
      if (r.status === 401 || r.status === 403) return "wrong-key"
    } catch {
      // not answering yet
    }
    await sleep(2_000)
  }
  return "down"
}

// butlerFlow runs the whole setup: resume what is already managed,
// install and start what is not, then import the account. Every
// step is a parameter so the flow can be tested without a machine.
async function butlerFlow(deps = {}) {
  const base = deps.base ?? DEFAULT_BASE
  const dir = deps.dir ?? managedDir()
  const importAccount = deps.importFlow ?? importFlow
  const failed = (error) => ({ type: "failed", error })

  // something already answering at the instance's address?
  let heard = 0
  try {
    heard = (await ask(base, "", `${base}/models`, 3_000)).status
  } catch {}
  if (heard) {
    const key = (deps.readManagedKey ?? readManagedKey)(dir)
    let pool
    if (key) {
      try {
        pool = await probe(base, key)
      } catch {
        pool = undefined
      }
    }
    if (pool === undefined)
      return failed(
        `An instance is already answering at ${base}, but it isn't one magpie set up — sign in with "Connect to a muse2api instance" and its key instead, or stop that instance and try again.`,
      )
    if (pool && (pool.total ?? 0) > 0) return { type: "success", provider: ID, key, metadata: { base } }
    return importAccount(base, key)
  }

  // install, key, start
  if (!(await (deps.isInstalled ?? isInstalled)(dir)) && !(await (deps.install ?? install)(dir)))
    return failed(
      "Couldn't download muse2api from GitHub — the setup needs git (or tar/unzip) and a network that reaches github.com. Or run muse2api yourself and use \"Connect to a muse2api instance\".",
    )
  const key = await (deps.ensureKey ?? ensureManagedKey)(dir)
  let started = false
  if (await (deps.dockerReady ?? dockerReady)()) started = await (deps.startDocker ?? startDocker)(dir)
  if (!started) {
    const python = await (deps.findPython ?? findPython)()
    if (!python)
      return failed(
        "muse2api is downloaded, but nothing can run it: no Docker (installed and running) and no Python 3.10+. Install Python from python.org or start Docker Desktop, then sign in again.",
      )
    started = await (deps.startPython ?? ((d) => startPython(d, python)))(dir)
  }
  if (!started)
    return failed(`muse2api was installed at ${dir} but didn't start — its log is ${join(dir, "muse2api.log")} (or Docker's output, if it used Docker).`)
  const up = await (deps.waitUp ?? waitUp)(base, key)
  if (up !== "up")
    return failed(
      up === "wrong-key"
        ? `The instance at ${base} came up but doesn't take the managed key — it may have been replaced by another instance. Stop whatever serves ${base} and sign in again.`
        : `The managed instance didn't answer within 90 seconds — its log is ${join(dir, "muse2api.log")}.`,
    )

  // accounts already there (a resumed install) need no window
  const pool = await probe(base, key).catch(() => null)
  if (pool && (pool.total ?? 0) > 0) return { type: "success", provider: ID, key, metadata: { base } }
  return importAccount(base, key)
}

async function butlerSignIn() {
  return {
    url: "",
    instructions:
      "Magpie sets muse2api up on this machine for you: it downloads it once into ~/.muse2api-plugin, starts it (it keeps running after magpie closes), and opens a Chrome window for the muse.ai sign-in. Downloading and first start can take a few minutes. The only step that is yours is signing in to muse.ai in that window.",
    method: "auto",
    callback: () => butlerFlow(),
  }
}

export async function Muse2apiPlugin({ client } = {}) {
  return {
    auth: {
      provider: ID,
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth?.type !== "api" || !auth.key) return {}
        // the instance takes its key as a plain bearer token, which is
        // what the AI SDK sends apiKey as — no signing fetch is needed
        const { key } = auth
        return { baseURL: baseURL(provider, auth), apiKey: key }
      },
      methods: [
        {
          type: "oauth",
          label: "Set up muse2api for me (automatic)",
          authorize: butlerSignIn,
        },
        {
          type: "oauth",
          label: "Connect to a muse2api instance",
          prompts: PROMPTS,
          authorize: connect,
        },
        {
          type: "oauth",
          label: "Connect and import your Muse account",
          prompts: PROMPTS,
          authorize: importSignIn,
        },
        { type: "api", label: "muse2api key (the MUSE2API_KEY of your instance)" },
      ],
      // magpie's usage card: the instance's account pool, from its
      // /admin/status — how many Muse accounts it holds and how many
      // are ready to answer
      async usage(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "api" || !auth.key) return { error: "not signed in", signIn: "kept" }
        const base = baseURL(undefined, auth)
        let res
        try {
          res = await ask(base, auth.key, adminURL(base, "/admin/status"))
        } catch (e) {
          return { error: e.message, signIn: "kept" }
        }
        if (!res.ok) return { error: `the instance at ${base} answered /admin/status with ${res.status}`, signIn: "kept" }
        const stats = (await res.json().catch(() => null))?.stats
        if (!stats) return { error: `the instance at ${base} sent no account stats`, signIn: "kept" }
        if (!stats.total) return { error: "no Muse accounts imported into the instance yet", signIn: "kept" }
        const enabled = stats.enabled ?? stats.total
        const healthy = stats.healthy ?? 0
        return {
          plan: "muse2api instance",
          windows: [
            {
              name: "Accounts",
              used: enabled > 0 ? Math.round((100 * (enabled - healthy)) / enabled) : 0,
              display: `${healthy} of ${enabled} accounts ready`,
            },
          ],
          signIn: "kept",
        }
      },
    },
    async config(config) {
      config.provider ??= {}
      const was = config.provider[ID] ?? {}
      config.provider[ID] = {
        name: "Muse (muse2api)",
        npm: CHAT,
        api: baseURL(),
        ...was,
        models: { ...Object.fromEntries(MODELS.map((m) => [m.id, modelEntry(m)])), ...(was.models ?? {}) },
      }
    },
    // the instance's own list, read live: what it serves is the
    // account's answer, so a model the instance gains appears here
    // without a plugin update. Media models are endpoints an agent
    // cannot chat with and are left out. When the instance does not
    // answer, the declared list stands.
    provider: {
      id: ID,
      async models(provider, { auth } = {}) {
        if (auth?.type !== "api" || !auth.key) return provider.models
        try {
          const base = baseURL(provider, auth)
          const res = await ask(base, auth.key, `${base}/models`, 8_000)
          if (!res.ok) return provider.models
          const list = ((await res.json())?.data ?? []).filter((m) => m?.id && !MEDIA_ID.test(m.id))
          if (!list.length) return provider.models
          return Object.fromEntries(
            list.map((m) => [m.id, modelEntry({ id: m.id, name: m.id === "muse-spark" ? "Muse Spark" : m.id })]),
          )
        } catch {
          return provider.models
        }
      },
    },
  }
}

// for tests
export const _internal = { chromeCandidates, findChrome, pickCookies, importFlow, parseInputs, butlerFlow, managedDir, readManagedKey, ensureManagedKey, genKey }
