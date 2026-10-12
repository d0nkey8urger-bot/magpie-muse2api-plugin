#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""傻瓜版 muse2api —— 不依赖任何网关工具的一键安装。

它做的事和 magpie 插件里的「管家」一模一样，只是脱离 magpie 独立运行:
  1. 把内置的 muse2api 源码装到 ~/.muse2api-plugin(已装则跳过)
  2. 生成并写好这个实例自己的 API key
  3. 启动服务(Docker 优先，否则 Python 虚拟环境)
  4. 弹出一个隔离的浏览器窗口，你在里面登录 muse.ai，账号自动导入
  5. 发一条真实小请求验真 —— Muse 真的回话了才算完成
  6. 打印「接入信息卡」:API 地址、key、模型，外加 magpie 手填字段和
     cc-switch 一键导入链接。装完往哪接、用什么工具，是你自己的事。

只依赖 Python 标准库(3.10+)。重复运行是安全的:实例在跑且账号可用时，
它只把接入信息卡再打印一遍；账号失效时，它带你重新导入。

用法:
    python muse2api-setup.py           # 安装 / 续号 / 打印卡片
    python muse2api-setup.py --card    # 只打印接入信息卡
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = "http://127.0.0.1:18610"
BASE = ROOT + "/v1"
MODEL = "muse-spark"
REPO_ZIP = "https://github.com/czg86389-hub/muse2api/archive/refs/heads/main.zip"
PLACEHOLDER = "m2a_your_secret_admin_key_here"


def say(text: str = "") -> None:
    print(text, flush=True)


def managed_dir() -> Path:
    home = os.environ.get("MUSE2API_PLUGIN_HOME", "")
    return Path(home) if home else Path.home() / ".muse2api-plugin"


def find_bundle() -> Path | None:
    here = Path(__file__).resolve().parent
    for cand in (
        here / "vendor" / "muse2api",
        here / "muse2api" / "vendor" / "muse2api",
        here.parent / "vendor" / "muse2api",
    ):
        if (cand / "app.py").exists():
            return cand
    return None


def install(d: Path) -> bool:
    if (d / "app.py").exists():
        return True
    d.mkdir(parents=True, exist_ok=True)
    bundle = find_bundle()
    if bundle is not None:
        say(f"使用插件内置的 muse2api 源码，安装到 {d} …")
        shutil.copytree(bundle, d, dirs_exist_ok=True)
        return (d / "app.py").exists()
    say("内置源码不在身边，改从 GitHub 下载 muse2api …")
    try:
        with urllib.request.urlopen(REPO_ZIP, timeout=300) as r:
            data = r.read()
        with zipfile.ZipFile(BytesIO(data)) as z:
            for name in z.namelist():
                parts = name.split("/", 1)
                if len(parts) < 2 or not parts[1]:
                    continue
                target = d / parts[1]
                if name.endswith("/"):
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(z.read(name))
    except Exception as e:  # download or extraction failed
        say(f"下载失败:{e}")
        return False
    return (d / "app.py").exists()


def read_key(d: Path) -> str | None:
    try:
        m = re.search(r"^MUSE2API_KEY=(\S+)$", (d / ".env").read_text(encoding="utf-8"), re.M)
    except OSError:
        return None
    return m.group(1) if m and m.group(1) != PLACEHOLDER else None


def ensure_key(d: Path) -> str:
    existing = read_key(d)
    if existing:
        return existing
    key = "m2a_" + secrets.token_hex(24)
    env_path = d / ".env"
    try:
        text = env_path.read_text(encoding="utf-8")
    except OSError:
        text = ""
    if re.search(r"^MUSE2API_KEY=.*$", text, re.M):
        text = re.sub(r"^MUSE2API_KEY=.*$", f"MUSE2API_KEY={key}", text, flags=re.M)
    else:
        text = f"{text}{'' if not text or text.endswith(chr(10)) else chr(10)}MUSE2API_KEY={key}\n"
    env_path.write_text(text, encoding="utf-8")
    return key


def ask(url: str, key: str, timeout: float, data: bytes | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("Authorization", f"Bearer {key}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def models_state(key: str, timeout: float = 3.0) -> str:
    try:
        status, _ = ask(f"{BASE}/models", key, timeout)
    except Exception:
        return "down"
    if status == 200:
        return "up"
    if status in (401, 403):
        return "wrong-key"
    return "down"


def wait_up(key: str, timeout_s: float = 90.0) -> str:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        state = models_state(key)
        if state != "down":
            return state
        time.sleep(2)
    return "down"


def pool(key: str) -> dict | None:
    try:
        status, body = ask(f"{ROOT}/admin/status", key, 10)
        if status != 200:
            return None
        return json.loads(body).get("stats") or {}
    except Exception:
        return None


def verify(key: str) -> tuple[bool, str]:
    payload = json.dumps(
        {"model": MODEL, "messages": [{"role": "user", "content": "Say ok"}], "max_tokens": 4, "stream": False}
    ).encode()
    try:
        status, body = ask(f"{BASE}/chat/completions", key, 180, data=payload)
    except Exception as e:
        return False, f"请求没发出去:{e}"
    try:
        doc = json.loads(body)
    except Exception:
        return False, f"实例回了读不懂的内容(HTTP {status})"
    if status == 200 and doc.get("choices"):
        return True, ""
    err = doc.get("error") or {}
    detail = err.get("message") or doc.get("detail") or doc.get("message") or f"HTTP {status}"
    return False, str(detail)[:200]


def run(cmd: list[str], cwd: Path | None = None, timeout: float = 900) -> bool:
    try:
        return subprocess.run(cmd, cwd=cwd, timeout=timeout).returncode == 0
    except Exception:
        return False


def docker_ready() -> bool:
    if not run(["docker", "--version"], timeout=10):
        return False
    return run(["docker", "info"], timeout=20)


def start_docker(d: Path) -> bool:
    say("用 Docker 启动服务(第一次要构建镜像，可能几分钟)…")
    return run(["docker", "compose", "up", "-d"], cwd=d)


def start_python(d: Path) -> bool:
    venv = d / "venv"
    venv_py = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not venv_py.exists():
        say("第一次运行:创建 Python 虚拟环境并安装依赖(可能几分钟)…")
        if not run([sys.executable, "-m", "venv", "venv"], cwd=d, timeout=300):
            return False
        uvicorn = "uvicorn>=0.32" if os.name == "nt" else "uvicorn[standard]>=0.32"
        deps = ["fastapi>=0.115", uvicorn, "pydantic>=2.9", "requests>=2.32",
                "websocket-client>=1.8", "python-multipart>=0.0.9"]
        if not run([str(venv_py), "-m", "pip", "install", *deps], cwd=d):
            return False
    log = open(d / "muse2api.log", "ab")
    server_py = venv_py
    attempts: list[dict] = []
    if os.name == "nt":
        # 关窗不死三件套:用无控制台的 pythonw.exe 跑服务(根本没有窗口
        # 可以误关)、DETACHED_PROCESS 脱离父控制台、再尽量脱离启动器
        # 的 job object(某些终端会连坐杀掉子进程)。
        pythonw = venv / "Scripts" / "pythonw.exe"
        if pythonw.exists():
            server_py = pythonw
        detached = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        attempts = [{"creationflags": detached | 0x01000000}, {"creationflags": detached}]
    else:
        attempts = [{"start_new_session": True}]
    proc = None
    for extra in attempts:
        try:
            proc = subprocess.Popen(
                [str(server_py), "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "18610"],
                cwd=d, stdin=subprocess.DEVNULL, stdout=log, stderr=log, **extra,
            )
            break
        except OSError:
            continue
    if proc is None:
        return False
    try:
        (d / "muse2api.pid").write_text(str(proc.pid), encoding="utf-8")
    except OSError:
        pass
    return True


def start_managed(d: Path) -> str:
    if docker_ready() and start_docker(d):
        return "docker"
    if start_python(d):
        return "python"
    return "failed"


def cc_link(app: str, key: str) -> str:
    q = urllib.parse.urlencode([
        ("resource", "provider"), ("app", app), ("name", "Muse (muse2api)"),
        ("homepage", "https://muse.ai"), ("endpoint", BASE), ("apiKey", key),
        ("model", MODEL), ("enabled", "true"),
        ("notes", "Muse (muse.ai) through a local muse2api instance"),
    ])
    return f"ccswitch://v1/import?{q}"


def print_card(d: Path) -> bool:
    key = read_key(d)
    if not key:
        say(f"没有找到托管安装的 key({d / '.env'})。")
        say("先完整运行一次本脚本完成安装，这里才有信息可显示。")
        return False
    say()
    say("========== muse2api 接入信息 ==========")
    say(f"API 地址: {BASE}")
    say(f"API Key : {key}")
    say(f"模型    : {MODEL}")
    say()
    say("-- 已经在用 magpie: 新建自定义供应商, 四项照上面填 --")
    say("   供应商名 muse2api / 地址 / key / 模型 muse-spark")
    say()
    say("-- 已经在用 cc-switch: 把对应链接粘到浏览器打开, 即刻导入 --")
    say(f"Codex   : {cc_link('codex', key)}")
    say(f"OpenCode: {cc_link('opencode', key)}")
    say("=========================================")
    return True


def do_import(d: Path, key: str) -> int:
    tool = d / "tools" / "get_muse_cookie.py"
    if not tool.exists():
        say(f"导号工具不在 {tool}，安装不完整。")
        return 3
    say()
    say("接下来会弹出一个独立的浏览器窗口，请在里面登录 muse.ai。")
    say("登录完成的那一刻，账号会被自动导入 —— 密码只输给 muse.ai 本身。")
    cmd = [sys.executable, str(tool), "--base", ROOT, "--key", key]
    chrome = os.environ.get("MUSE2API_CHROME", "")
    if chrome:
        cmd += ["--chrome", chrome]
    try:
        rc = subprocess.run(cmd).returncode
    except KeyboardInterrupt:
        rc = 130
    stats = pool(key)
    if not stats or not stats.get("total"):
        say()
        say("这次没有导进来(窗口被提前关掉，或者登录没走完)。")
        say("没关系，再运行一次本脚本就会直接回到这一步。")
        return 3
    say("账号已导入，正在验真(发一条真实小请求)…")
    ok, detail = verify(key)
    if not ok:
        say()
        say(f"账号导进来了，但 Muse 还不能回话:{detail}")
        say("多半是账号已过期或受限 —— 再运行一次本脚本，重新登录导入即可。")
        return 3
    if rc != 0:
        say("(导号工具报告了一个小插曲，但验真通过，以验真为准。)")
    return 0


def main() -> int:
    d = managed_dir()
    if "--card" in sys.argv:
        return 0 if print_card(d) else 1
    say("=" * 60)
    say("  muse2api 傻瓜版安装 —— 装好、登录、打印接入信息")
    say("=" * 60)

    key = read_key(d)
    if key and (d / "app.py").exists():
        if models_state(key, timeout=5) == "up":
            stats = pool(key)
            if stats and stats.get("total", 0) > 0 and stats.get("healthy", 0) > 0:
                say("已有一套在跑的实例，正在验真…")
                ok, _ = verify(key)
                if ok:
                    say("一切正常，无需重装。你的接入信息:")
                    print_card(d)
                    return 0
            say("实例在跑，但账号需要导入或刷新 —— 直接进入导入这一步。")
            return finish_import(d, key)
        say("实例装过但没在运行，正在重新启动…")
    else:
        if not install(d):
            say("muse2api 没装上(内置源码缺失且下载失败)，把上面的输出发回来看看。")
            return 2
        key = ensure_key(d)
        say("API key 已生成并写好。")

    started = start_managed(d)
    if started == "failed":
        say("服务没能启动:这台机器需要 Docker，或 Python 3.10+，两者都没就绪。")
        say(f"细节看日志:{d / 'muse2api.log'}(Python 路线时)。")
        return 2
    state = wait_up(key)
    if state != "up":
        say(f"服务起来了但没在 90 秒内应答(状态:{state})，日志在 {d / 'muse2api.log'}。")
        return 2
    say("服务已经在 http://127.0.0.1:18610 运行(后台无窗口，关掉本窗口不影响它)。")
    stats = pool(key)
    if stats and stats.get("total", 0) > 0 and stats.get("healthy", 0) > 0:
        ok, _ = verify(key)
        if ok:
            say("账号池里已有可用账号，无需导入。你的接入信息:")
            print_card(d)
            return 0
    return finish_import(d, key)


def finish_import(d: Path, key: str) -> int:
    rc = do_import(d, key)
    if rc == 0:
        say()
        say("全部完成。你的接入信息(收好，以后想再看就再运行一次本脚本):")
        print_card(d)
    return rc


if __name__ == "__main__":
    sys.exit(main())
