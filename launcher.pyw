"""AI 饥饿秀 启动器：用图形界面配置参数、启动 / 停止服务、看日志和实时状态。

    双击 启动器.bat（或直接双击本文件）。只用标准库（tkinter），不用额外安装。
"""
import json
import os
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import tkinter as tk
import urllib.request
import webbrowser
from pathlib import Path
from tkinter import messagebox, ttk

ROOT = Path(__file__).resolve().parent
SCRIPT_DIR = ROOT / "script"
WORDS_DIR = ROOT / "words"
ENV_FILE = SCRIPT_DIR / "ai_related" / ".env"
REQUIREMENTS = SCRIPT_DIR / "ai_related" / "requirements.txt"
SETTINGS_FILE = ROOT / "launcher_settings.json"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
FONT = "Microsoft YaHei UI"

try:  # sharp text on high-DPI screens
    import ctypes
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except Exception:
    pass

# (label, key, default, hint)
PARAMS = [
    ("端口", "port", "8000", "网页地址里的端口号"),
    ("每轮间隔（秒）", "delay", "2", "越大越慢，也越省钱"),
    ("费用上限（美元）", "budget", "1.0", "本次运行估算花费超过就自动暂停"),
    ("寿命平均值（轮）", "mean", "41", "正式规则是 41；调小可以更快看到死亡"),
    ("寿命标准差", "sd", "15", "正式规则是 15"),
    ("选手总数上限", "max_players", "", "累计出生这么多人后不再出生；留空 = 不限"),
    ("总轮数上限", "max_rounds", "", "跑满这么多轮就暂停；留空 = 不限"),
    ("随机种子", "seed", "", "填数字可复现寿命和出生；留空 = 随机"),
]
PRESETS = {
    "快速体验": dict(delay="1", budget="0.3", mean="8", sd="3"),
    "正式规则": dict(delay="2", budget="1.0", mean="41", sd="15"),
    "省钱慢速": dict(delay="6", budget="0.2", mean="41", sd="15"),
}
STOP_REASONS = {"stopped": "已手动暂停", "budget": "费用达到上限", "max_rounds": "达到轮数上限",
                "max_players": "选手出生数已达上限", "victory": "选手获胜，游戏结束"}


def python_exe(path: str) -> str:
    """pythonw.exe has no console and swallows stdout; the server needs the console flavour."""
    p = Path(path)
    if p.name.lower() == "pythonw.exe" and (p.parent / "python.exe").exists():
        return str(p.parent / "python.exe")
    return path


def list_worlds() -> list[tuple[str, str]]:
    out = []
    if WORDS_DIR.is_dir():
        for d in sorted(WORDS_DIR.iterdir()):
            if not d.is_dir():
                continue
            title = d.name
            try:
                title = json.loads((d / "world.json").read_text(encoding="utf-8")).get("name") or d.name
            except Exception:
                pass
            out.append((d.name, title))
    return out


def read_key() -> str:
    try:
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("DEEPSEEK=") or line.strip().startswith("DEEPSEEK_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return os.environ.get("DEEPSEEK", "") or os.environ.get("DEEPSEEK_API_KEY", "")


def write_key(key: str) -> None:
    lines = []
    if ENV_FILE.exists():
        lines = [ln for ln in ENV_FILE.read_text(encoding="utf-8").splitlines() if not ln.strip().startswith("DEEPSEEK=")]
    lines.append(f"DEEPSEEK={key}")
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def mask(key: str) -> str:
    return "（未设置）" if not key else (key[:3] + "…" + key[-4:] if len(key) > 10 else "已设置")


def port_free(port: int, host: str) -> bool:
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


TUNNEL_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def find_cloudflared() -> str | None:
    """cloudflared on PATH, in tools/, or where winget / the installer puts it."""
    found = shutil.which("cloudflared")
    if found:
        return found
    candidates = [ROOT / "tools" / "cloudflared.exe"]
    for var in ("ProgramFiles", "ProgramFiles(x86)"):
        if os.environ.get(var):
            candidates.append(Path(os.environ[var]) / "cloudflared" / "cloudflared.exe")
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidates.append(Path(local) / "Microsoft" / "WinGet" / "Links" / "cloudflared.exe")
        candidates += list((Path(local) / "Microsoft" / "WinGet" / "Packages").glob("Cloudflare.cloudflared*/cloudflared.exe"))
    return next((str(c) for c in candidates if c.exists()), None)


def lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "电脑IP"


class Launcher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("AI 饥饿秀 · 启动器")
        self.proc: subprocess.Popen | None = None
        self.stopping = False
        self.token = ""                       # the admin token of THIS run of the server (start / stop need it)
        self.tunnel: subprocess.Popen | None = None
        self.logq: queue.Queue[str] = queue.Queue()
        self.ready = False
        self.opened = False
        self.status: dict | None = None
        self.status_lock = threading.Lock()
        self.worlds = list_worlds()
        self.saved = self._load_settings()
        self._style()
        self._build()
        self._refresh_key()
        self._update_command()
        self._update_buttons()
        self.update_idletasks()  # fit the window to the (tall) settings column
        h = min(self.winfo_reqheight() + 8, self.winfo_screenheight() - 80)
        self.geometry(f"1060x{h}")
        self.minsize(960, min(h, 640))
        threading.Thread(target=self._check_deps, daemon=True).start()
        self.after(100, self._pump)
        self.after(1000, self._poll_status)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ---- settings ---------------------------------------------------------
    def _load_settings(self) -> dict:
        try:
            return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save_settings(self) -> None:
        data = {k: v.get() for k, v in self.vars.items()}
        try:
            SETTINGS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            pass

    # ---- ui ---------------------------------------------------------------
    def _style(self) -> None:
        st = ttk.Style(self)
        if "vista" in st.theme_names():
            st.theme_use("vista")
        self.option_add("*Font", (FONT, 10))
        st.configure("TLabelframe.Label", font=(FONT, 10, "bold"))
        st.configure("Big.TButton", font=(FONT, 11, "bold"), padding=(10, 6))
        st.configure("Hint.TLabel", foreground="#777777")
        st.configure("Ok.TLabel", foreground="#1a7f37")
        st.configure("Bad.TLabel", foreground="#c62828")

    def _build(self) -> None:
        S = self.saved
        self.vars: dict[str, tk.Variable] = {}
        names = [n for n, _ in self.worlds] or ["example"]
        default_world = S.get("world") if S.get("world") in names else ("turtle" if "turtle" in names else names[0])
        self.vars["world"] = tk.StringVar(value=default_world)
        for _, key, default, _ in PARAMS:
            self.vars[key] = tk.StringVar(value=S.get(key, default))
        for key, default in (("lan", False), ("autostart", True), ("open_browser", True), ("per_world", True), ("share", False)):
            self.vars[key] = tk.BooleanVar(value=S.get(key, default))
        self.vars["python"] = tk.StringVar(value=S.get("python") or python_exe(sys.executable))
        self.vars["share_mode"] = tk.StringVar(value=S.get("share_mode") if S.get("share_mode") in ("quick", "named") else "quick")
        self.vars["tunnel_name"] = tk.StringVar(value=S.get("tunnel_name", "hunger-show"))
        self.vars["tunnel_domain"] = tk.StringVar(value=S.get("tunnel_domain", ""))
        self.key_var = tk.StringVar()
        self.public_url = tk.StringVar(value="")
        self.show_key = tk.BooleanVar(value=False)

        left = ttk.Frame(self, padding=(12, 10, 6, 10))
        right = ttk.Frame(self, padding=(6, 10, 12, 10))
        left.pack(side="left", fill="y")
        right.pack(side="left", fill="both", expand=True)

        # world
        box = ttk.LabelFrame(left, text="世界", padding=8)
        box.pack(fill="x")
        self.world_box = ttk.Combobox(box, state="readonly", width=34, values=[f"{n}　{t}" if t != n else n for n, t in self.worlds])
        self.world_box.pack(fill="x")
        keys = [n for n, _ in self.worlds]
        if default_world in keys:
            self.world_box.current(keys.index(default_world))
        self.world_box.bind("<<ComboboxSelected>>", self._on_world)
        self.world_info = ttk.Label(box, style="Hint.TLabel", wraplength=330, justify="left")
        self.world_info.pack(anchor="w", pady=(4, 0))
        self._show_world_info()

        # api key
        box = ttk.LabelFrame(left, text="DeepSeek API Key", padding=8)
        box.pack(fill="x", pady=(8, 0))
        self.key_status = ttk.Label(box)
        self.key_status.pack(anchor="w")
        row = ttk.Frame(box)
        row.pack(fill="x", pady=(4, 0))
        self.key_entry = ttk.Entry(row, textvariable=self.key_var, show="•")
        self.key_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="保存", width=6, command=self._save_key).pack(side="left", padx=(6, 0))
        ttk.Checkbutton(box, text="显示输入内容", variable=self.show_key,
                        command=lambda: self.key_entry.config(show="" if self.show_key.get() else "•")).pack(anchor="w", pady=(2, 0))
        ttk.Label(box, text="保存在 script/ai_related/.env（已被 git 忽略）。改了要重启服务才生效。",
                  style="Hint.TLabel", wraplength=330).pack(anchor="w")

        # presets
        box = ttk.LabelFrame(left, text="预设", padding=8)
        box.pack(fill="x", pady=(8, 0))
        for i, name in enumerate(PRESETS):
            ttk.Button(box, text=name, command=lambda n=name: self._preset(n)).grid(row=0, column=i, padx=(0 if i == 0 else 4, 0), sticky="ew")
            box.columnconfigure(i, weight=1)

        # params
        box = ttk.LabelFrame(left, text="参数", padding=8)
        box.pack(fill="x", pady=(8, 0))
        box.columnconfigure(1, weight=1)
        self.tips: dict[str, str] = {}
        for r, (label, key, _, hint) in enumerate(PARAMS):
            ttk.Label(box, text=label).grid(row=r, column=0, sticky="w", pady=2)
            e = ttk.Entry(box, textvariable=self.vars[key], width=12)
            e.grid(row=r, column=1, sticky="w", padx=(8, 0))
            ttk.Label(box, text=hint, style="Hint.TLabel").grid(row=r, column=2, sticky="w", padx=(8, 0))
            self.vars[key].trace_add("write", lambda *_: self._update_command())

        opts = ttk.LabelFrame(left, text="选项", padding=8)
        opts.pack(fill="x", pady=(8, 0))
        for text, key in (("启动后自动开始游戏", "autostart"), ("服务就绪后自动打开浏览器", "open_browser"),
                          ("每个世界独立存档（logs/<世界名>）", "per_world"),
                          ("允许同一局域网的设备访问（手机）", "lan")):
            ttk.Checkbutton(opts, text=text, variable=self.vars[key], command=self._update_command).pack(anchor="w")
        self.vars["world"].trace_add("write", lambda *_: self._update_command())

        # right: command + buttons + status + log
        ttk.Label(right, text="将要执行的命令", font=(FONT, 10, "bold")).pack(anchor="w")
        self.cmd_text = tk.Text(right, height=5, wrap="word", relief="solid", borderwidth=1, background="#f6f6f6", font=("Consolas", 9))
        self.cmd_text.pack(fill="x", pady=(2, 8))

        bar = ttk.Frame(right)
        bar.pack(fill="x")
        self.start_btn = ttk.Button(bar, text="▶ 启动服务", style="Big.TButton", command=self._start)
        self.stop_btn = ttk.Button(bar, text="■ 停止服务", style="Big.TButton", command=self._stop)
        self.open_btn = ttk.Button(bar, text="打开网页", style="Big.TButton", command=self._open_web)
        for b in (self.start_btn, self.stop_btn, self.open_btn):
            b.pack(side="left", padx=(0, 6))

        bar2 = ttk.Frame(right)
        bar2.pack(fill="x", pady=(8, 0))
        self.play_btn = ttk.Button(bar2, text="开始游戏", command=lambda: self._api("start"))
        self.pause_btn = ttk.Button(bar2, text="暂停游戏", command=lambda: self._api("stop"))
        self.clear_btn = ttk.Button(bar2, text="清空存档…", command=self._clear_save)
        self.folder_btn = ttk.Button(bar2, text="打开存档文件夹", command=self._open_folder)
        for b in (self.play_btn, self.pause_btn, self.clear_btn, self.folder_btn):
            b.pack(side="left", padx=(0, 6))

        self.status_label = ttk.Label(right, text="服务未启动", font=(FONT, 10, "bold"))
        self.status_label.pack(anchor="w", pady=(10, 0))
        self.status_sub = ttk.Label(right, text="", style="Hint.TLabel", wraplength=560, justify="left")
        self.status_sub.pack(anchor="w")

        # public link for friends
        box = ttk.LabelFrame(right, text="公网分享（给朋友看）", padding=8)
        box.pack(fill="x", pady=(10, 0))
        ttk.Checkbutton(box, text="服务就绪后，自动开启公网分享（Cloudflare Tunnel，免费）",
                        variable=self.vars["share"], command=self._share_toggled).pack(anchor="w")
        ttk.Radiobutton(box, text="临时链接：不用注册账号，每次启动链接都不一样（xxx.trycloudflare.com）",
                        variable=self.vars["share_mode"], value="quick", command=self._share_mode_changed).pack(anchor="w", pady=(4, 0))
        ttk.Radiobutton(box, text="固定域名：用你托管在 Cloudflare 的域名 + 命名隧道（需要 Cloudflare 账号）",
                        variable=self.vars["share_mode"], value="named", command=self._share_mode_changed).pack(anchor="w")
        row = ttk.Frame(box)
        row.pack(fill="x", pady=(2, 0), padx=(22, 0))
        ttk.Label(row, text="域名").pack(side="left")
        self.domain_entry = ttk.Entry(row, textvariable=self.vars["tunnel_domain"], width=22)
        self.domain_entry.pack(side="left", padx=(6, 0))
        ttk.Label(row, text="隧道名").pack(side="left", padx=(10, 0))
        self.tname_entry = ttk.Entry(row, textvariable=self.vars["tunnel_name"], width=14)
        self.tname_entry.pack(side="left", padx=(6, 0))
        self.setup_btn = ttk.Button(row, text="首次设置…", command=self._setup_named)
        self.setup_btn.pack(side="right")
        row = ttk.Frame(box)
        row.pack(fill="x", pady=(4, 0))
        self.cf_label = ttk.Label(row, text="", style="Hint.TLabel")
        self.cf_label.pack(side="left")
        self.cf_install_btn = ttk.Button(row, text="一键安装 cloudflared", command=self._install_cloudflared)
        self.cf_install_btn.pack(side="right")
        ttk.Button(row, text="手动下载", command=lambda: webbrowser.open("https://github.com/cloudflare/cloudflared/releases/latest")).pack(side="right", padx=(0, 6))
        row = ttk.Frame(box)
        row.pack(fill="x", pady=(6, 0))
        self.link_entry = ttk.Entry(row, textvariable=self.public_url, state="readonly")
        self.link_entry.pack(side="left", fill="x", expand=True)
        self.copy_btn = ttk.Button(row, text="复制", width=6, command=self._copy_link)
        self.copy_btn.pack(side="left", padx=(6, 0))
        self.share_hint = ttk.Label(box, style="Hint.TLabel", wraplength=560, justify="left")
        self.share_hint.pack(anchor="w", pady=(6, 0))
        self._sync_share_ui()

        # python / deps
        box = ttk.LabelFrame(right, text="运行环境", padding=8)
        box.pack(fill="x", pady=(10, 0))
        row = ttk.Frame(box)
        row.pack(fill="x")
        ttk.Entry(row, textvariable=self.vars["python"]).pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="检查", width=6, command=lambda: threading.Thread(target=self._check_deps, daemon=True).start()).pack(side="left", padx=(6, 0))
        row = ttk.Frame(box)
        row.pack(fill="x", pady=(4, 0))
        self.deps_label = ttk.Label(row, text="依赖：检查中…", style="Hint.TLabel")
        self.deps_label.pack(side="left")
        self.install_btn = ttk.Button(row, text="安装依赖", command=self._install_deps)
        self.install_btn.pack(side="right")

        head = ttk.Frame(right)
        head.pack(fill="x", pady=(10, 2))
        ttk.Label(head, text="日志", font=(FONT, 10, "bold")).pack(side="left")
        ttk.Button(head, text="清除", width=6, command=lambda: self._log_clear()).pack(side="right")
        wrap = ttk.Frame(right)
        wrap.pack(fill="both", expand=True)
        self.log = tk.Text(wrap, height=8, wrap="word", state="disabled", relief="solid", borderwidth=1, background="#1e1e1e",
                           foreground="#d4d4d4", font=("Consolas", 9), insertbackground="#d4d4d4")
        sb = ttk.Scrollbar(wrap, command=self.log.yview)
        self.log.config(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.log.pack(side="left", fill="both", expand=True)
        self.log.tag_config("sys", foreground="#4fc1ff")
        self.log.tag_config("err", foreground="#f48771")
        self._say("启动器就绪。选好世界和参数，点「启动服务」。", "sys")
        self._refresh_cf()

    # ---- helpers ----------------------------------------------------------
    def _say(self, text: str, tag: str = "") -> None:
        self.log.config(state="normal")
        self.log.insert("end", text.rstrip("\n") + "\n", tag)
        lines = int(self.log.index("end-1c").split(".")[0])
        if lines > 3000:
            self.log.delete("1.0", f"{lines - 3000}.0")
        self.log.see("end")
        self.log.config(state="disabled")

    def _log_clear(self) -> None:
        self.log.config(state="normal")
        self.log.delete("1.0", "end")
        self.log.config(state="disabled")

    def _world(self) -> str:
        i = self.world_box.current()
        return self.worlds[i][0] if 0 <= i < len(self.worlds) else "example"

    def _on_world(self, _=None) -> None:
        self.vars["world"].set(self._world())
        self._show_world_info()

    def _show_world_info(self) -> None:
        name = self._world()
        d = WORDS_DIR / name / "system prompt"
        parts = []
        for fname, label in (("tribute.md", "选手"), ("playground.md", "环境"), ("judge.md", "裁判"), ("oracle.md", "神谕")):
            f = d / fname
            parts.append(f"{label}{'✓' if f.exists() and len(f.read_text(encoding='utf-8').strip()) >= 30 else '✗'}")
        extra = ""
        if not (d / "judge.md").exists() or not (d / "oracle.md").exists():
            extra = "\n没有裁判 / 神谕提示词的世界，没有规则惩罚，也不能通关（占位示例）。"
        try:
            n = len(json.loads((WORDS_DIR / name / "world.json").read_text(encoding="utf-8")).get("scripture", []))
        except Exception:
            n = 0
        self.world_info.config(text=f"words/{name}　提示词：{' '.join(parts)}　圣言 {n} 条{extra}")

    def _preset(self, name: str) -> None:
        for k, v in PRESETS[name].items():
            self.vars[k].set(v)
        self._say(f"已套用预设「{name}」", "sys")

    def _save_key(self) -> None:
        key = self.key_var.get().strip()
        if not key:
            messagebox.showinfo("API Key", "请先输入 Key。")
            return
        write_key(key)
        self.key_var.set("")
        self._refresh_key()
        self._say("API Key 已保存。" + ("（服务正在运行，需要重启才生效）" if self._running() else ""), "sys")

    def _refresh_key(self) -> None:
        key = read_key()
        self.key_status.config(text=f"当前：{mask(key)}", style="Ok.TLabel" if key else "Bad.TLabel")

    # ---- command ----------------------------------------------------------
    def _data_dir(self) -> str:
        return f"logs/{self._world()}" if self.vars["per_world"].get() else "logs/game"

    def _args(self) -> list[str] | None:
        """Validated server arguments, or None (and an error dialog) when a field is bad."""
        a = ["--world", self._world(), "--data-dir", self._data_dir()]
        host = "0.0.0.0" if self.vars["lan"].get() else "127.0.0.1"
        a += ["--host", host]
        specs = [("port", int, "端口", 1, 65535), ("delay", float, "每轮间隔", 0, 3600), ("budget", float, "费用上限", 0, 10000),
                 ("mean", float, "寿命平均值", 2, 80), ("sd", float, "寿命标准差", 0, 100),
                 ("max_players", int, "选手总数上限", 1, 10**6), ("max_rounds", int, "总轮数上限", 1, 10**6), ("seed", int, "随机种子", -10**12, 10**12)]
        for key, cast, label, lo, hi in specs:
            raw = self.vars[key].get().strip()
            if raw == "":
                if key in ("port", "delay", "budget", "mean", "sd"):
                    self._bad(f"「{label}」不能为空")
                    return None
                continue
            try:
                v = cast(raw)
            except ValueError:
                self._bad(f"「{label}」要填数字：{raw}")
                return None
            if not lo <= v <= hi:
                self._bad(f"「{label}」要在 {lo} ~ {hi} 之间")
                return None
            a += ["--" + key.replace("_", "-"), str(v)]
        if not self.vars["autostart"].get():
            a.append("--no-autostart")
        return a

    def _bad(self, msg: str) -> None:
        if getattr(self, "_quiet", False):
            return
        messagebox.showwarning("参数有误", msg)

    def _update_command(self) -> None:
        self._quiet = True
        try:
            args = self._args()
        finally:
            self._quiet = False
        txt = "（有参数填得不对，点「启动服务」会提示）" if args is None else \
            f'cd script\n{python_exe(self.vars["python"].get())} -m ai_related.server ' + " ".join(args) + " --admin-token <每次启动随机生成>"
        self.cmd_text.config(state="normal")
        self.cmd_text.delete("1.0", "end")
        self.cmd_text.insert("1.0", txt)
        self.cmd_text.config(state="disabled")

    # ---- deps -------------------------------------------------------------
    def _check_deps(self) -> None:
        py = python_exe(self.vars["python"].get())
        try:
            r = subprocess.run([py, "-c", "import openai, fastapi, uvicorn, dotenv"], capture_output=True, text=True,
                               timeout=60, creationflags=NO_WINDOW)
            ok, msg = r.returncode == 0, (r.stderr.strip().splitlines() or [""])[-1]
        except Exception as e:
            ok, msg = False, str(e)
        self.logq.put("\x01" + ("1" if ok else "0") + msg)  # handled on the UI thread by _pump

    def _deps_result(self, ok: bool, msg: str) -> None:
        self.deps_ok = ok
        self.deps_label.config(text="依赖：已安装 ✓" if ok else f"依赖：缺少或解释器不可用（{msg[:60]}）", style="Ok.TLabel" if ok else "Bad.TLabel")
        self.install_btn.config(state="disabled" if ok else "normal")

    def _install_deps(self) -> None:
        py = python_exe(self.vars["python"].get())
        self._say(f"安装依赖：{py} -m pip install -r requirements.txt", "sys")
        self.install_btn.config(state="disabled")

        def work():
            try:
                p = subprocess.Popen([py, "-m", "pip", "install", "-r", str(REQUIREMENTS)], stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
                for line in p.stdout:
                    self.logq.put(line)
                p.wait()
                self.logq.put(f"[pip 结束，退出码 {p.returncode}]\n")
            except Exception as e:
                self.logq.put(f"[pip 失败] {e}\n")
            self._check_deps()

        threading.Thread(target=work, daemon=True).start()

    # ---- server process ---------------------------------------------------
    def _running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def _port(self) -> int:
        try:
            return int(self.vars["port"].get())
        except ValueError:
            return 8000

    def _start(self) -> None:
        if self._running():
            return
        if not read_key():
            messagebox.showwarning("缺少 API Key", "还没有设置 DeepSeek API Key。请先在左边填写并点「保存」。")
            return
        args = self._args()
        if args is None:
            return
        port = self._port()
        host = "0.0.0.0" if self.vars["lan"].get() else "127.0.0.1"
        if not port_free(port, host):
            messagebox.showwarning("端口被占用", f"端口 {port} 已被占用（可能上一个服务还开着）。换一个端口，或先关掉占用它的程序。")
            return
        py = python_exe(self.vars["python"].get())
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
        self.token = secrets.token_urlsafe(12)  # only this launcher knows it: friends who open the link can watch, not control
        try:
            self.proc = subprocess.Popen([py, "-u", "-m", "ai_related.server", *args, "--admin-token", self.token], cwd=SCRIPT_DIR, env=env,
                                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                         errors="replace", creationflags=NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
        except OSError as e:
            messagebox.showerror("启动失败", f"无法运行 Python：{py}\n{e}")
            return
        self.ready = False
        self.opened = False
        self.stopping = False
        self.status = None
        self._save_settings()
        self._say(f"启动服务（世界：{self._world()}，端口 {port}）…", "sys")
        threading.Thread(target=self._reader, args=(self.proc,), daemon=True).start()
        self._update_buttons()

    def _reader(self, proc: subprocess.Popen) -> None:
        for line in proc.stdout:
            self.logq.put(line)
        code = proc.wait()
        self.logq.put("\x00" + ("[服务已停止]" if self.stopping else f"[服务意外退出，退出码 {code}]") + "\n")

    def _stop(self) -> None:
        if not self._running():
            return
        self._say("停止服务…", "sys")
        self._stop_tunnel()
        self.stopping = True
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self._update_buttons()

    def _pump(self) -> None:
        try:
            while True:
                line = self.logq.get_nowait()
                if line.startswith("\x02"):
                    self._tunnel_up(line[1:].strip())
                elif line.startswith("\x03"):
                    if self.tunnel is None or self.tunnel.poll() is not None:  # not when a replacement tunnel is already up
                        self.public_url.set("")
                    self._say("公网链接已关闭。", "sys")
                elif line.startswith("\x01"):
                    self._deps_result(line[1] == "1", line[2:])
                elif line.startswith("\x00"):
                    self._stop_tunnel()
                    self._say(line[1:], "sys")
                    self.ready = False
                    self.status = None
                    self._update_buttons()
                else:
                    low = line.lower()
                    self._say(line, "err" if ("error" in low or "traceback" in low or "exception" in low) else "")
        except queue.Empty:
            pass
        self.after(100, self._pump)

    # ---- talking to the server -------------------------------------------
    def _base(self) -> str:
        return f"http://127.0.0.1:{self._port()}"

    def _poll_status(self) -> None:
        if self._running():
            threading.Thread(target=self._fetch_status, daemon=True).start()
        self._render_status()
        self.after(1500, self._poll_status)

    def _fetch_status(self) -> None:
        try:
            with urllib.request.urlopen(self._base() + "/api/state", timeout=1.0) as r:
                data = json.loads(r.read().decode("utf-8"))
        except Exception:
            data = None
        with self.status_lock:
            self.status = data

    def _render_status(self) -> None:
        with self.status_lock:
            s = self.status
        if not self._running():
            self.status_label.config(text="● 服务未启动", foreground="#777777")
            self.status_sub.config(text="")
            self._update_buttons()
            return
        if s is None:
            self.ready = False
            self.status_label.config(text="● 服务启动中…", foreground="#b26a00")
            self.status_sub.config(text="")
        else:
            if not self.ready:
                self.ready = True
                self._say(f"服务就绪：{self._base()}", "sys")
                if self.vars["open_browser"].get() and not self.opened:
                    self.opened = True
                    self._open_web()
                if self.vars["share"].get():
                    self._start_tunnel()
            names = "、".join(p["name"] for p in s["players"]) or "无"
            if s["running"]:
                self.status_label.config(text="● 游戏进行中", foreground="#1a7f37")
            else:
                why = STOP_REASONS.get(s.get("stop_reason") or "", "")
                self.status_label.config(text="● 服务已就绪，游戏未在运行" + (f"（{why}）" if why else ""), foreground="#b26a00")
            err = f"\n出错：{s['error']}" if s.get("error") else ""
            watching = f"　观众 {s['viewers']} 人" if s.get("viewers") is not None else ""
            self.status_sub.config(text=f"第 {s['round']} 轮　在世：{names}　墓园 {s['graveyard_count']} 人　"
                                        f"本次估算花费 ${s['cost_usd']:.4f}{watching}{err}")
        self._update_buttons()

    def _api(self, action: str) -> None:
        def work():
            try:
                req = urllib.request.Request(f"{self._base()}/api/{action}", method="POST", data=b"",
                                             headers={"X-Admin-Token": self.token})
                urllib.request.urlopen(req, timeout=3).read()
                self.logq.put(f"[{'开始' if action == 'start' else '暂停'}游戏]\n")
            except Exception as e:
                self.logq.put(f"[请求失败] {e}\n")
        threading.Thread(target=work, daemon=True).start()

    def _open_web(self) -> None:
        webbrowser.open(self._base() + "/")
        if self.vars["lan"].get():
            self._say(f"手机访问：http://{lan_ip()}:{self._port()}/（需在同一 Wi-Fi，且防火墙放行）", "sys")

    # ---- public link (Cloudflare quick tunnel, or a named tunnel on your own domain) ----
    def _refresh_cf(self) -> None:
        exe = find_cloudflared()
        self.cf_label.config(text="cloudflared：已找到 ✓" if exe else "cloudflared：未安装（分享公网链接需要它，约 30MB）",
                             style="Ok.TLabel" if exe else "Bad.TLabel")
        self.cf_install_btn.config(state="disabled" if exe else "normal")

    def _install_cloudflared(self) -> None:
        if not messagebox.askyesno("安装 cloudflared", "将用 winget 安装 Cloudflare 官方的 cloudflared（命令行小工具，约 30MB）。\n继续吗？"):
            return
        self.cf_install_btn.config(state="disabled")
        self._say("安装 cloudflared：winget install Cloudflare.cloudflared …", "sys")

        def work():
            try:
                p = subprocess.Popen(["winget", "install", "--id", "Cloudflare.cloudflared", "-e", "--accept-package-agreements",
                                      "--accept-source-agreements"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                     encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
                for line in p.stdout:
                    if line.strip() and not set(line.strip()) <= set("-\\|/ █▒"):
                        self.logq.put(line)
                p.wait()
                self.logq.put(f"[winget 结束，退出码 {p.returncode}]\n")
            except OSError as e:
                self.logq.put(f"[没有找到 winget：{e}。请点「手动下载」，把 cloudflared.exe 放进仓库的 tools 文件夹]\n")
            self.after(0, self._refresh_cf)

        threading.Thread(target=work, daemon=True).start()

    def _share_toggled(self) -> None:
        self._save_settings()
        if self.vars["share"].get():
            if self.ready:
                self._start_tunnel()
        else:
            self._stop_tunnel()

    def _named(self) -> tuple[str, str] | None:
        """(tunnel name, bare domain) for the fixed-domain mode, or None while either field is empty."""
        name = self.vars["tunnel_name"].get().strip()
        domain = re.sub(r"^https?://", "", self.vars["tunnel_domain"].get().strip(), flags=re.I).strip("/").lower()
        return (name, domain) if name and domain else None

    def _sync_share_ui(self) -> None:
        named = self.vars["share_mode"].get() == "named"
        for w in (self.domain_entry, self.tname_entry, self.setup_btn):
            w.config(state="normal" if named else "disabled")
        common = "朋友只能观看，不能启停你的游戏；大家看的是同一局，不会多花 API 钱（花费上限照旧）。"
        self.share_hint.config(text=common + (
            "链接固定不变，但你的电脑休眠或关机时打不开。第一次用先点「首次设置…」（登录 Cloudflare、建隧道、绑域名，只做一次）。"
            if named else "你的电脑休眠或关机，链接就断；每次启动，链接都不一样。"))

    def _share_mode_changed(self) -> None:
        self._sync_share_ui()
        self._save_settings()
        if self.tunnel is not None and self.tunnel.poll() is None:  # switch the running tunnel over
            self._stop_tunnel()
            if self.vars["share"].get() and self.ready:
                self._start_tunnel()

    def _setup_named(self) -> None:
        exe = find_cloudflared()
        if not exe:
            messagebox.showinfo("固定域名", "还没有安装 cloudflared：请先点「一键安装 cloudflared」。")
            return
        nd = self._named()
        if not nd:
            messagebox.showinfo("固定域名", "先填写域名（例如 example.com）和隧道名。")
            return
        name, domain = nd
        if not messagebox.askyesno("首次设置固定域名", f"将依次运行：\n"
                                   f"1. cloudflared tunnel login（没登录过才运行：会打开浏览器，选中 {domain} 并授权）\n"
                                   f"2. cloudflared tunnel create {name}（已存在就跳过）\n"
                                   f"3. cloudflared tunnel route dns {name} {domain}\n\n只需做一次。继续吗？"):
            return
        self._save_settings()
        self.setup_btn.config(state="disabled")

        def run(*args: str) -> tuple[int, str]:
            self.logq.put(f"[cloudflared {' '.join(args)}]\n")
            p = subprocess.Popen([exe, *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                 encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
            out = []
            for line in p.stdout:
                out.append(line)
                self.logq.put(line)
            return p.wait(), "".join(out).lower()

        def work():
            try:
                if not (Path.home() / ".cloudflared" / "cert.pem").exists():
                    self.logq.put("[请在打开的浏览器里登录 Cloudflare，选中你的域名并点授权…]\n")
                    if run("tunnel", "login")[0] != 0:
                        self.logq.put("[登录没有完成，设置中止]\n")
                        return
                code, out = run("tunnel", "create", name)
                if code != 0 and "already exists" not in out:
                    self.logq.put("[创建隧道失败，设置中止]\n")
                    return
                code, out = run("tunnel", "route", "dns", name, domain)
                if code != 0:
                    self.logq.put(f"[绑定域名失败：{domain} 可能已有别的 DNS 记录。到 Cloudflare 后台 → DNS 删掉它的 A / AAAA / CNAME 记录后再点一次]\n"
                                  if "already exists" in out else "[绑定域名失败，设置中止]\n")
                    return
                self.logq.put(f"[设置完成 ✓ 勾选「自动开启公网分享」，服务就绪后朋友就能打开 https://{domain}]\n")
            except OSError as e:
                self.logq.put(f"[无法运行 cloudflared：{e}]\n")
            finally:
                self.after(0, self._sync_share_ui)

        threading.Thread(target=work, daemon=True).start()

    def _start_tunnel(self) -> None:
        if self.tunnel is not None and self.tunnel.poll() is None:
            return
        exe = find_cloudflared()
        if not exe:
            self._say("想分享公网链接，但还没有安装 cloudflared：请点「一键安装 cloudflared」，装好后重新勾选。", "err")
            self.vars["share"].set(False)
            return
        origin = f"http://127.0.0.1:{self._port()}"
        fixed_url = None
        if self.vars["share_mode"].get() == "named":
            nd = self._named()
            if not nd:
                self._say("固定域名模式要先填写域名和隧道名。", "err")
                self.vars["share"].set(False)
                return
            name, domain = nd
            fixed_url = f"https://{domain}"
            cmd = [exe, "tunnel", "--no-autoupdate", "run", "--url", origin, name]
            self._say(f"连接隧道 {name} → {fixed_url} …", "sys")
        else:
            cmd = [exe, "tunnel", "--url", origin, "--no-autoupdate"]
            self._say("生成公网链接中（通常几秒钟）…", "sys")
        try:
            self.tunnel = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                           errors="replace", creationflags=NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
        except OSError as e:
            self._say(f"无法运行 cloudflared：{e}", "err")
            return
        threading.Thread(target=self._tunnel_reader, args=(self.tunnel, fixed_url), daemon=True).start()

    def _tunnel_reader(self, proc: subprocess.Popen, fixed_url: str | None) -> None:
        """A quick tunnel prints its random link; a named tunnel's link is known up front and is live once a
        connection to Cloudflare registers."""
        found = False
        for line in proc.stdout:
            if found:
                if " ERR " in line:
                    self.logq.put(line)   # e.g. the origin went away -- worth seeing
                continue
            if fixed_url:
                url = fixed_url if "Registered tunnel connection" in line else None
            else:
                m = TUNNEL_URL.search(line)
                url = m.group(0) if m else None
            if url:
                found = True
                self.logq.put("\x02" + url + "\n")
            else:
                self.logq.put(line)       # until the link shows up, cloudflared's own messages help with diagnosing
        proc.wait()
        self.logq.put("\x03\n")

    def _tunnel_up(self, url: str) -> None:
        self.public_url.set(url)
        self.clipboard_clear()
        self.clipboard_append(url)
        self._say(f"公网链接（已复制到剪贴板）：{url}", "sys")

    def _stop_tunnel(self) -> None:
        if self.tunnel is not None and self.tunnel.poll() is None:
            # taskkill /T also ends anything the tunnel started (a .bat wrapper, for instance)
            subprocess.run(["taskkill", "/PID", str(self.tunnel.pid), "/T", "/F"], capture_output=True, creationflags=NO_WINDOW)
        self.tunnel = None
        self.public_url.set("")  # the link is dead the moment we stop

    def _copy_link(self) -> None:
        url = self.public_url.get()
        if url:
            self.clipboard_clear()
            self.clipboard_append(url)
            self._say("链接已复制。", "sys")

    # ---- save data --------------------------------------------------------
    def _data_path(self) -> Path:
        return SCRIPT_DIR / self._data_dir()

    def _clear_save(self) -> None:
        d = self._data_path()
        if self._running():
            messagebox.showinfo("请先停止服务", "服务正在运行。先点「停止服务」，再清空存档。")
            return
        if not d.exists():
            messagebox.showinfo("没有存档", f"{d}\n不存在，已经是空的。")
            return
        if messagebox.askyesno("清空存档", f"将删除：\n{d}\n\n里面的墓园、圣言触发次数、对话记录都会消失，无法恢复。\n确定吗？", icon="warning"):
            shutil.rmtree(d, ignore_errors=True)
            self._say(f"已清空存档：{d}", "sys")

    def _open_folder(self) -> None:
        d = self._data_path()
        d.mkdir(parents=True, exist_ok=True)
        os.startfile(d)

    # ---- misc -------------------------------------------------------------
    def _update_buttons(self) -> None:
        running = self._running()
        with self.status_lock:
            ready = running and self.status is not None
            playing = bool(self.status and self.status.get("running"))
        self.start_btn.config(state="disabled" if running else "normal")
        self.stop_btn.config(state="normal" if running else "disabled")
        self.open_btn.config(state="normal" if ready else "disabled")
        self.play_btn.config(state="normal" if ready and not playing else "disabled")
        self.pause_btn.config(state="normal" if ready and playing else "disabled")
        self.clear_btn.config(state="disabled" if running else "normal")

    def _on_close(self) -> None:
        if self._running():
            if not messagebox.askyesno("退出", "服务还在运行，退出会同时关闭服务。确定退出吗？"):
                return
            self.proc.terminate()
        self._stop_tunnel()
        self._save_settings()
        self.destroy()


if __name__ == "__main__":
    Launcher().mainloop()
