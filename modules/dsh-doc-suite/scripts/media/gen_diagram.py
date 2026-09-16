#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mermaid 图示渲染 —— B 线施工 ⑥（本地渲染：Node + mermaid-cli + 本机 Edge；**无云端**）。

设计依据：55 号第八章。要点：
  - Node 依赖**不进 dependencies / files**（避免 puppeteer 的 postinstall 下载 Chromium 拖垮插件安装）；
    标准位置 ~/.dsh/data/dsh-doc-suite/tools/mermaid/（用 setup_mermaid.ps1 安装或迁移）；
  - 本脚本**不自动安装任何依赖**：运行时缺失时打印安装命令并 exit 4（可回退：导出 SVG 人工插图）；
  - puppeteer 用**本机 Edge**（--puppeteerConfigFile），未提供配置时按常见路径自动生成临时配置。

命令：
  py -3 gen_diagram.py render <in.mmd> <out.png|svg> [--tools-dir DIR] [--scale 2] [--theme default]
  py -3 gen_diagram.py check [--tools-dir DIR]

退出码：0 成功 ｜ 2 参数/输入错 ｜ 4 运行时缺失或渲染失败（可回退）
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
for _p in (str(SCRIPTS),):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import cli_guard  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

EXIT_FALLBACK = 4
STANDARD_DIR = Path.home() / ".dsh" / "data" / "dsh-doc-suite" / "tools" / "mermaid"
INSTALL_HINT = (
    "安装（不下载 Chromium，用本机 Edge；任选其一）：\n"
    "  powershell -ExecutionPolicy Bypass -File <DOC_SUITE_SCRIPTS>\\media\\setup_mermaid.ps1 -Install\n"
    "  或手工：在 ~/.dsh/data/dsh-doc-suite/tools/mermaid 下执行\n"
    "    $env:PUPPETEER_SKIP_DOWNLOAD=1; npm install @mermaid-js/mermaid-cli@11.17.0 puppeteer@25.11.0"
)
EDGE_CANDIDATES = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
)


def _cli_js(tools_dir: Path):
    return Path(tools_dir) / "node_modules" / "@mermaid-js" / "mermaid-cli" / "src" / "cli.js"


def _candidates(tools_dir=None):
    out = []
    if tools_dir:
        out.append(Path(tools_dir))
    env = os.environ.get("DSH_DOC_SUITE_MERMAID")
    if env:
        out.append(Path(env))
    out.append(STANDARD_DIR)
    tools_root = STANDARD_DIR.parent
    if tools_root.is_dir():
        for child in sorted(tools_root.iterdir()):
            if child.is_dir():
                out.append(child)
    seen, uniq = set(), []
    for p in out:
        key = str(p)
        if key not in seen:
            seen.add(key)
            uniq.append(p)
    return uniq


def find_runtime(tools_dir=None):
    for cand in _candidates(tools_dir):
        cli = _cli_js(cand)
        if cli.is_file():
            return cand, cli
    return None, None


def _edge_path():
    for p in EDGE_CANDIDATES:
        if Path(p).is_file():
            return p
    return None


def _puppeteer_cfg(tools_dir: Path, tmp_out: Path):
    """优先用运行时里的 puppeteer.json；没有则按本机 Edge 生成临时配置。"""
    existing = Path(tools_dir) / "puppeteer.json"
    if existing.is_file():
        try:
            cfg = json.loads(existing.read_text(encoding="utf-8-sig"))
            if cfg.get("executablePath"):
                return existing, cfg.get("executablePath")
        except Exception:
            pass
    edge = _edge_path()
    if not edge:
        raise cli_guard.InputError("运行时缺 puppeteer.json，且未找到本机 Edge（请安装 Edge 或提供配置）")
    tmp_out.write_text(json.dumps({"executablePath": edge.replace("\\", "/")}), encoding="utf-8")
    return tmp_out, edge


def cmd_check(args):
    tools, cli = find_runtime(args.tools_dir)
    if not tools:
        print("运行时: 未找到（应位于 %s）" % STANDARD_DIR)
        print(INSTALL_HINT)
        return EXIT_FALLBACK
    print("运行时: %s" % tools)
    print("入口  : %s" % cli)
    edge = _edge_path()
    print("Edge  : %s" % (edge or "未找到（mermaid-cli 需浏览器；未下载 Chromium 时必须用 Edge）"))
    pkg = Path(tools) / "node_modules" / "puppeteer" / "package.json"
    if pkg.is_file():
        try:
            print("puppeteer: v%s" % json.loads(pkg.read_text(encoding="utf-8"))["version"])
        except Exception:
            pass
    return 0


def cmd_render(args):
    src = Path(args.src)
    out = Path(args.out)
    if src.suffix.lower() not in (".mmd", ".mermaid", ".txt"):
        raise cli_guard.InputError("输入应为 .mmd / .mermaid 文本文件：%s" % src)
    if out.suffix.lower() not in (".png", ".svg"):
        raise cli_guard.InputError("输出扩展名应为 .png 或 .svg：%s" % out)
    tools, cli = find_runtime(args.tools_dir)
    if not tools:
        print("错误: 找不到 mermaid 运行时（应位于 %s）。" % STANDARD_DIR, file=sys.stderr)
        print(INSTALL_HINT, file=sys.stderr)
        print("提示: 这是**可回退**情形（exit %d）——可先导出 SVG 由人工插图。" % EXIT_FALLBACK, file=sys.stderr)
        return EXIT_FALLBACK

    tmp_cfg = Path(os.environ.get("TEMP", ".")) / ("ds-mmdc-%d.json" % os.getpid())
    try:
        cfg_path, _edge = _puppeteer_cfg(Path(tools), tmp_cfg)
    except cli_guard.InputError as exc:
        print("错误: %s" % exc, file=sys.stderr)
        return EXIT_FALLBACK
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["node", str(cli), "-i", str(src), "-o", str(out), "-p", str(cfg_path)]
    if args.theme:
        cmd += ["-t", str(args.theme)]
    if args.scale:
        cmd += ["-s", str(args.scale)]
    if args.background:
        cmd += ["-b", str(args.background)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=max(10, int(args.timeout_ms / 1000)))
    except Exception as exc:                         # noqa: BLE001
        print("错误: 调用 mermaid-cli 失败：%s" % type(exc).__name__, file=sys.stderr)
        return EXIT_FALLBACK
    finally:
        try:
            if tmp_cfg.exists():
                tmp_cfg.unlink()
        except OSError:
            pass
    if proc.returncode != 0 or not out.is_file():
        tail = (proc.stderr or proc.stdout or "").strip()[-400:]
        print("错误: mermaid 渲染失败（exit %d）：%s" % (proc.returncode, tail), file=sys.stderr)
        print("提示: 常见原因是浏览器主版本不匹配或 mmd 语法错误；exit %d（可回退 SVG）。"
              % EXIT_FALLBACK, file=sys.stderr)
        return EXIT_FALLBACK
    print("OK: 已渲染 %s（%d 字节）" % (out, out.stat().st_size))
    return 0


def main():
    parser = argparse.ArgumentParser(description="mermaid 图示渲染（本地，无云端）")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("render", help="把 .mmd 渲染成 PNG/SVG（运行时缺失 → exit 4）")
    p.add_argument("src", help="输入 .mmd / .mermaid")
    p.add_argument("out", help="输出 .png 或 .svg")
    p.add_argument("--tools-dir", dest="tools_dir", help="运行时目录（默认 %s）" % STANDARD_DIR)
    p.add_argument("--scale", type=float, default=2.0, help="缩放倍率（默认 2）")
    p.add_argument("--theme", default="default", help="mermaid 主题（default / neutral / dark / forest）")
    p.add_argument("--background", help="背景色（如 white / transparent）")
    p.add_argument("--timeout-ms", dest="timeout_ms", type=int, default=120000, help="渲染超时（毫秒）")
    p.set_defaults(fn=cmd_render)

    p = sub.add_parser("check", help="检查运行时与浏览器（不渲染）")
    p.add_argument("--tools-dir", dest="tools_dir")
    p.set_defaults(fn=cmd_check)

    args = parser.parse_args()
    cli_guard.check_inputs(args)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(cli_guard.run(main))
