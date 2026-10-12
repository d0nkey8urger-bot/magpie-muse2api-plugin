import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Muse2apiPlugin, _internal } from "./index.mjs"

const byLabel = (hooks, prefix) => hooks.auth.methods.find((m) => m.label.startsWith(prefix))

const ctx = { client: { app: { log: async () => {} }, auth: { set: async () => {} } } }
const signedIn = async () => ({ type: "api", key: "m2a_test_key" })

// A stub muse2api instance: /v1/models and /admin/status behind the
// one key, 401 without it — the shape the real service answers in.
// POST /admin/accounts bodies land in `captured` when one is passed.
async function stubInstance(t, stats = { total: 3, enabled: 3, healthy: 2 }, captured = null) {
  const server = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer m2a_test_key") {
      res.writeHead(401, { "content-type": "application/json" })
      return res.end(JSON.stringify({ error: "unauthorized" }))
    }
    if (req.url === "/admin/accounts" && req.method === "POST") {
      let body = ""
      req.on("data", (c) => (body += c))
      req.on("end", () => {
        const parsed = JSON.parse(body)
        captured?.push(parsed)
        res.writeHead(200, { "content-type": "application/json" })
        res.end(
          JSON.stringify({ added: [{ label: parsed.label, id: "acc-1", cookie_count: Object.keys(parsed.cookies ?? {}).length }] }),
        )
      })
      return
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" })
      return res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "muse-spark" }, { id: "muse-image" }, { id: "muse-video" }],
        }),
      )
    }
    if (req.url === "/admin/status") {
      res.writeHead(200, { "content-type": "application/json" })
      return res.end(JSON.stringify({ stats }))
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  t.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}/v1`
}

test("auth hook: the provider, a loader, the butler, two guided methods and a key method", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  assert.equal(hooks.auth.provider, "muse2api")
  assert.equal(typeof hooks.auth.loader, "function")
  assert.equal(hooks.auth.methods.length, 4)
  const [butler, connect, importer, key] = hooks.auth.methods
  assert.equal(butler.type, "oauth")
  assert.equal(typeof butler.authorize, "function")
  assert.equal(butler.prompts, undefined)
  for (const m of [connect, importer]) {
    assert.equal(m.type, "oauth")
    assert.equal(typeof m.authorize, "function")
    assert.deepEqual(
      m.prompts.map((p) => p.key),
      ["base", "key"],
    )
  }
  assert.equal(key.type, "api")
})

test("loader: nothing until signed in with a key", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  assert.deepEqual(await hooks.auth.loader(async () => undefined), {})
  assert.deepEqual(await hooks.auth.loader(async () => ({ type: "oauth" })), {})
  assert.deepEqual(await hooks.auth.loader(async () => ({ type: "api" })), {})
})

test("loader: the instance's default address and the pasted key", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const out = await hooks.auth.loader(signedIn)
  assert.equal(out.apiKey, "m2a_test_key")
  assert.equal(out.baseURL, "http://127.0.0.1:18610/v1")
})

test("loader: the address saved by the guided connect wins over everything", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const auth = async () => ({ type: "api", key: "m2a_test_key", metadata: { base: "http://10.0.0.9:18610/v1" } })
  const out = await hooks.auth.loader(auth, { options: { baseURL: "http://192.168.1.10:18610/v1" } })
  assert.equal(out.baseURL, "http://10.0.0.9:18610/v1")
})

test("loader: a baseURL in the provider options wins, slashes trimmed", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const out = await hooks.auth.loader(signedIn, { options: { baseURL: "http://192.168.1.10:18610/v1/" } })
  assert.equal(out.baseURL, "http://192.168.1.10:18610/v1")
})

test("loader: MUSE2API_BASE_URL moves the instance when nothing else is set", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  process.env.MUSE2API_BASE_URL = "http://example.test:18610/v1"
  try {
    const out = await hooks.auth.loader(signedIn, {})
    assert.equal(out.baseURL, "http://example.test:18610/v1")
  } finally {
    delete process.env.MUSE2API_BASE_URL
  }
})

test("connect: a live instance is checked, then the sign-in is saved with its address", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  const connect = byLabel(hooks, "Connect to")
  const offer = await connect.authorize({ base, key: "m2a_test_key" })
  assert.equal(offer.method, "auto")
  assert.match(offer.instructions, /2 of 3 Muse accounts ready/)
  const done = await offer.callback()
  assert.equal(done.type, "success")
  assert.equal(done.provider, "muse2api")
  assert.equal(done.key, "m2a_test_key")
  assert.equal(done.metadata.base, base)
})

test("connect: an empty address falls back to the instance's default", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  const connect = byLabel(hooks, "Connect to")
  // the stub is not at the default address, so this cannot succeed —
  // and whichever way it fails (nothing there, or an instance that
  // refuses the stub's key), the error names the default address,
  // which is what proves the default was used
  await assert.rejects(() => connect.authorize({ base: "", key: "m2a_test_key" }), /127\.0\.0\.1:18610/)
  assert.ok(base)
})

test("connect: a wrong key is refused in words", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  await assert.rejects(() => byLabel(hooks, "Connect to").authorize({ base, key: "m2a_wrong" }), /refused that key/)
})

test("connect: a dead address is unreachable in words", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  await assert.rejects(
    () => byLabel(hooks, "Connect to").authorize({ base: "http://127.0.0.1:1/v1", key: "m2a_test_key" }),
    /Couldn't reach a muse2api instance/,
  )
})

test("connect: a bad address and a missing key are said plainly", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  await assert.rejects(() => byLabel(hooks, "Connect to").authorize({ base: "not a url", key: "x" }), /isn't an address/)
  await assert.rejects(
    () => byLabel(hooks, "Connect to").authorize({ base: "http://127.0.0.1:18610/v1", key: " " }),
    /MUSE2API_KEY/,
  )
})

test("models hook: the instance's live list, media models left out", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  const auth = { type: "api", key: "m2a_test_key", metadata: { base } }
  const out = await hooks.provider.models({ models: { stale: { name: "Stale" } } }, { auth })
  assert.deepEqual(Object.keys(out), ["muse-spark"])
  assert.equal(out["muse-spark"].name, "Muse Spark")
  assert.equal(out["muse-spark"].tool_call, true)
})

test("models hook: the declared list stands when the instance does not answer", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const declared = { "muse-spark": { name: "Muse Spark" } }
  const auth = { type: "api", key: "m2a_test_key", metadata: { base: "http://127.0.0.1:1/v1" } }
  assert.deepEqual(await hooks.provider.models({ models: declared }, { auth }), declared)
  assert.deepEqual(await hooks.provider.models({ models: declared }, { auth: undefined }), declared)
})

test("usage: the account pool as magpie's card shows it", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  const getAuth = async () => ({ type: "api", key: "m2a_test_key", metadata: { base } })
  const out = await hooks.auth.usage(getAuth)
  assert.equal(out.plan, "muse2api instance")
  assert.equal(out.windows[0].name, "Accounts")
  assert.equal(out.windows[0].display, "2 of 3 accounts ready")
  assert.equal(out.windows[0].used, 33)
  assert.equal(out.signIn, "kept")
})

test("usage: an instance with no accounts says so", async (t) => {
  const base = await stubInstance(t, { total: 0, enabled: 0, healthy: 0 })
  const hooks = await Muse2apiPlugin(ctx)
  const getAuth = async () => ({ type: "api", key: "m2a_test_key", metadata: { base } })
  const out = await hooks.auth.usage(getAuth)
  assert.match(out.error, /no Muse accounts imported/)
})

test("usage: not signed in is an error, not a crash", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const out = await hooks.auth.usage(async () => undefined)
  assert.equal(out.error, "not signed in")
})

test("config hook: declares the provider, its protocol and its model", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const cfg = { provider: {} }
  await hooks.config(cfg)
  const p = cfg.provider.muse2api
  assert.equal(p.npm, "@ai-sdk/openai-compatible")
  assert.equal(p.api, "http://127.0.0.1:18610/v1")
  assert.deepEqual(Object.keys(p.models), ["muse-spark"])
  assert.equal(p.models["muse-spark"].tool_call, true)
})

test("config hook: a user's own model entries survive", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const cfg = { provider: { muse2api: { models: { mine: { name: "Mine" } } } } }
  await hooks.config(cfg)
  assert.deepEqual(Object.keys(cfg.provider.muse2api.models).sort(), ["mine", "muse-spark"])
})

// ---- the account import (ported from muse2api's get_muse_cookie.py) ----

const ESSENTIAL = ["hatch_sess", "hatch_gw", "hatch_vml", "hatch_native_auth_device"]
const fullCookieJar = () => [
  ...ESSENTIAL.map((name) => ({ name, value: `v-${name}`, domain: ".muse.ai", expires: 1893456000.7, httpOnly: true })),
  { name: "other_muse", value: "x", domain: "muse.ai", expires: -1, httpOnly: false },
  { name: "foreign", value: "nope", domain: ".google.com", expires: 1893456000, httpOnly: false },
]
const fakeProc = () => ({ exitCode: null, killed: false, kill() { this.killed = true } })

test("import: pickCookies keeps the muse.ai cookies, shaped for the account pool", () => {
  const got = _internal.pickCookies(fullCookieJar())
  assert.deepEqual(Object.keys(got).sort(), [...ESSENTIAL, "other_muse"].sort())
  assert.equal(got.hatch_sess.value, "v-hatch_sess")
  assert.equal(got.hatch_sess.expires, 1893456000)
  assert.equal(got.hatch_sess.httpOnly, true)
  assert.equal(got.other_muse.expires, -1)
})

test("import: browser candidates per platform, and the MUSE2API_CHROME override", () => {
  const win = _internal.chromeCandidates("win32", { ProgramFiles: "C:\\PF", "ProgramFiles(x86)": "C:\\PF86", LOCALAPPDATA: "C:\\LA" })
  assert.ok(win.some((p) => p.includes("chrome.exe")))
  assert.ok(win.some((p) => p.includes("msedge.exe")))
  const mac = _internal.chromeCandidates("darwin", {})
  assert.ok(mac[0].includes("Google Chrome.app"))
  const linux = _internal.chromeCandidates("linux", {})
  assert.ok(linux.includes("google-chrome"))
  assert.deepEqual(_internal.chromeCandidates("linux", { MUSE2API_CHROME: "/opt/browser" }), ["/opt/browser"])
})

test("import: the whole flow — window, sign-in lands, session uploaded, sign-in saved", async (t) => {
  const captured = []
  const base = await stubInstance(t, { total: 3, enabled: 3, healthy: 2 }, captured)
  let polls = 0
  const proc = fakeProc()
  const done = await _internal.importFlow(base, "m2a_test_key", {
    findChrome: () => "/fake/chrome",
    freePort: async () => 9333,
    launch: async (chrome, port) => {
      assert.equal(chrome, "/fake/chrome")
      assert.equal(port, 9333)
      return { proc, profile: undefined }
    },
    waitForCdp: async () => "ws://fake",
    getCookies: async () => (++polls === 1 ? [] : fullCookieJar()),
    label: "test-label",
  })
  assert.equal(done.type, "success")
  assert.equal(done.provider, "muse2api")
  assert.equal(done.key, "m2a_test_key")
  assert.equal(done.metadata.base, base)
  assert.equal(done.metadata.account, "test-label")
  assert.equal(proc.killed, true)
  // the upload hit the stub instance in the instance's own shape:
  // values only, expiries only where positive, no foreign cookies
  assert.equal(captured.length, 1)
  assert.equal(captured[0].label, "test-label")
  assert.deepEqual(Object.keys(captured[0].cookies).sort(), [...ESSENTIAL, "other_muse"].sort())
  assert.equal(captured[0].cookies.hatch_sess, "v-hatch_sess")
  assert.deepEqual(Object.keys(captured[0].expires).sort(), [...ESSENTIAL].sort())
})

test("import: no browser on the machine is a failure in words", async () => {
  const done = await _internal.importFlow("http://127.0.0.1:18610/v1", "k", { findChrome: () => null })
  assert.equal(done.type, "failed")
  assert.match(done.error, /No Chrome, Edge, Brave or Chromium found/)
})

test("import: a debug port that never comes up is a failure in words", async () => {
  const done = await _internal.importFlow("http://127.0.0.1:18610/v1", "k", {
    findChrome: () => "/fake/chrome",
    freePort: async () => 9333,
    launch: async () => ({ proc: fakeProc(), profile: undefined }),
    waitForCdp: async () => {
      throw new Error("nope")
    },
  })
  assert.equal(done.type, "failed")
  assert.match(done.error, /debug port never came up/)
})

test("import: closing the window early is a failure in words", async () => {
  const proc = fakeProc()
  const done = await _internal.importFlow("http://127.0.0.1:18610/v1", "k", {
    findChrome: () => "/fake/chrome",
    freePort: async () => 9333,
    launch: async () => ({ proc, profile: undefined }),
    waitForCdp: async () => "ws://fake",
    getCookies: async () => {
      proc.exitCode = 1
      return []
    },
    pollMs: 1,
    timeoutMs: 5_000,
  })
  assert.equal(done.type, "failed")
  assert.match(done.error, /window was closed/)
})

test("import: a sign-in that never lands times out, counting what arrived", async () => {
  const two = fullCookieJar().filter((c) => ["hatch_sess", "hatch_gw"].includes(c.name))
  const done = await _internal.importFlow("http://127.0.0.1:18610/v1", "k", {
    findChrome: () => "/fake/chrome",
    freePort: async () => 9333,
    launch: async () => ({ proc: fakeProc(), profile: undefined }),
    waitForCdp: async () => "ws://fake",
    getCookies: async () => two,
    pollMs: 5,
    timeoutMs: 60,
  })
  assert.equal(done.type, "failed")
  assert.match(done.error, /Timed out waiting.*got 2 of 4/)
})

test("import: an instance that refuses the upload fails the sign-in with its words", async (t) => {
  const base = await stubInstance(t)
  let polls = 0
  const done = await _internal.importFlow(base, "m2a_test_key", {
    findChrome: () => "/fake/chrome",
    freePort: async () => 9333,
    launch: async () => ({ proc: fakeProc(), profile: undefined }),
    waitForCdp: async () => "ws://fake",
    getCookies: async () => (++polls === 1 ? [] : fullCookieJar()),
    upload: async () => {
      throw new Error("The instance refused the imported account (HTTP 500)")
    },
  })
  assert.equal(done.type, "failed")
  assert.match(done.error, /refused the imported account/)
})

test("import sign-in: the instance is checked first, then the window is offered", async (t) => {
  const base = await stubInstance(t)
  const hooks = await Muse2apiPlugin(ctx)
  const importer = byLabel(hooks, "Connect and import")
  const offer = await importer.authorize({ base, key: "m2a_test_key" })
  assert.equal(offer.method, "auto")
  assert.match(offer.instructions, /Chrome window opens on muse\.ai/)
  // the callback is not run here: it would open a real browser window.
  // importFlow, which the callback runs, is covered above with the
  // browser steps faked.
  await assert.rejects(() => importer.authorize({ base, key: "m2a_wrong" }), /refused that key/)
})

// ---- the butler: a managed instance, set up for the user ----

const okImport = (base, key) => Promise.resolve({ type: "success", provider: "muse2api", key, metadata: { base, account: "acc" } })
const DEAD = "http://127.0.0.1:1/v1"

test("butler sign-in: no prompts — the offer is the whole setup", async () => {
  const hooks = await Muse2apiPlugin(ctx)
  const butler = byLabel(hooks, "Set up muse2api")
  const offer = await butler.authorize()
  assert.equal(offer.method, "auto")
  assert.match(offer.instructions, /sets muse2api up on this machine/)
  // the callback is not run here: it would really set up an instance.
  // butlerFlow, which it runs, is covered below with the machine faked.
})

test("butler: a fresh machine — install, key, python start, up, import", async () => {
  const calls = []
  const done = await _internal.butlerFlow({
    base: DEAD,
    dir: "/anywhere",
    isInstalled: async () => false,
    install: async () => {
      calls.push("install")
      return true
    },
    ensureKey: async () => "m2a_butler_key",
    dockerReady: async () => false,
    findPython: async () => "python3",
    startPython: async () => {
      calls.push("start")
      return true
    },
    waitUp: async () => "up",
    importFlow: async (b, k) => {
      calls.push("import")
      assert.equal(k, "m2a_butler_key")
      return okImport(b, k)
    },
  })
  assert.equal(done.type, "success")
  assert.equal(done.key, "m2a_butler_key")
  assert.deepEqual(calls, ["install", "start", "import"])
})

test("butler: our instance already up, with accounts — straight to success, no window", async (t) => {
  const base = await stubInstance(t)
  const done = await _internal.butlerFlow({
    base,
    dir: "/anywhere",
    readManagedKey: () => "m2a_test_key",
    importFlow: async () => {
      throw new Error("must not import")
    },
  })
  assert.equal(done.type, "success")
  assert.equal(done.key, "m2a_test_key")
  assert.equal(done.metadata.base, base)
})

test("butler: our instance up with no accounts — the import runs", async (t) => {
  const base = await stubInstance(t, { total: 0, enabled: 0, healthy: 0 })
  let imported = false
  const done = await _internal.butlerFlow({
    base,
    dir: "/anywhere",
    readManagedKey: () => "m2a_test_key",
    importFlow: async (b, k) => {
      imported = true
      return okImport(b, k)
    },
  })
  assert.equal(done.type, "success")
  assert.ok(imported)
})

test("butler: a foreign instance on the address is refused in words", async (t) => {
  const base = await stubInstance(t)
  for (const readManagedKey of [() => null, () => "m2a_not_its_key"]) {
    const done = await _internal.butlerFlow({ base, dir: "/anywhere", readManagedKey })
    assert.equal(done.type, "failed")
    assert.match(done.error, /isn't one magpie set up/)
  }
})

test("butler: nothing can run it — no Docker, no Python", async () => {
  const done = await _internal.butlerFlow({
    base: DEAD,
    dir: "/anywhere",
    isInstalled: async () => true,
    ensureKey: async () => "m2a_k",
    dockerReady: async () => false,
    findPython: async () => null,
  })
  assert.equal(done.type, "failed")
  assert.match(done.error, /no Docker \(installed and running\) and no Python/)
})

test("butler: a start that never answers is a failure with the log's address", async () => {
  const done = await _internal.butlerFlow({
    base: DEAD,
    dir: "/anywhere",
    isInstalled: async () => true,
    ensureKey: async () => "m2a_k",
    dockerReady: async () => true,
    startDocker: async () => true,
    waitUp: async () => "down",
  })
  assert.equal(done.type, "failed")
  assert.match(done.error, /didn't answer within 90 seconds/)
})

test("butler: the managed key — generated once, read back, a placeholder replaced", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "butler-key-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const k1 = await _internal.ensureManagedKey(dir)
  assert.match(k1, /^m2a_[0-9a-f]{48}$/)
  assert.equal(await _internal.ensureManagedKey(dir), k1)
  assert.equal(_internal.readManagedKey(dir), k1)

  const dir2 = await mkdtemp(join(tmpdir(), "butler-key2-"))
  t.after(() => rm(dir2, { recursive: true, force: true }))
  await writeFile(join(dir2, ".env"), "MUSE2API_KEY=m2a_your_secret_admin_key_here\n")
  const k2 = await _internal.ensureManagedKey(dir2)
  assert.match(k2, /^m2a_[0-9a-f]{48}$/)
  assert.equal(_internal.readManagedKey(dir2), k2)

  assert.equal(_internal.managedDir({ MUSE2API_PLUGIN_HOME: "/somewhere" }), "/somewhere")
  assert.match(_internal.managedDir({}), /\.muse2api-plugin$/)
})
