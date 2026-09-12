#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-doc-suite 环境自检（doctor）

用途：在"按需补全"流程里充当唯一入口——检测解释器、依赖、WPS COM，缺什么就给出
**可直接复制执行的修复命令**（默认只报告，加 --fix 才真的执行 pip 安装）。

用法：
  py -3 doctor.py                # 只检测并报告（安全默认）
  py -3 doctor.py --json         # 机器可读输出（供 DSH 插件 /doc-doctor 解析）
  py -3 doctor.py --fix          # 检测后执行 pip 安装（需使用者明确同意；不装解释器）
  py -3 doctor.py --skip-wps     # 跳过 WPS COM 检查（非 Windows 或已知没装 WPS 时）
  py -3 doctor.py --emit-skill-paths   # 只输出本模块脚本/技能的**绝对路径**（供技能文档解析占位符）

技能文档里的路径占位符（对外分发时不写死作者机器路径）：
  <DOC_SUITE_SCRIPTS>  = 本模块 scripts/ 目录
  <DOC_SUITE_SKILLS>   = 本模块 skills/ 目录
  解析方法：`py -3 doctor.py --emit-skill-paths` 读出实际路径再替换。

设计红线：
  1. **不自动安装 Python 解释器**（装解释器是系统级操作，需管理员权限与企业网络策略）；
     检测不到合格解释器时，给出 winget / 官网两条路径，由使用者决定。
  2. **不静默失败**：每一项都给出 状态 / 证据 / 修复命令。
  3. Windows 上一律优先用 `py -3`（`python` 可能是 Microsoft Store 别名 stub，报错 exit 9009）。
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

# 控制台编码兜底（Windows GBK 控制台打印中文/符号会崩）
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

MIN_PYTHON = (3, 10)          # 由 PyMuPDF 1.28+ / fontTools 4.65+ 的 requires_python 决定
RECOMMENDED = "3.12"

MODULE_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = MODULE_DIR / "scripts"
SKILLS_DIR = MODULE_DIR / "skills"

# 技能文档里引用的工具（占位符 <DOC_SUITE_SCRIPTS> 的实际取值）
TOOL_FILES = {
    "word": "office/word_tool.py",
    "excel": "office/excel_tool.py",
    "ppt": "office/ppt_tool.py",
    "pdf": "pdf/pdf_tool.py",
}

# (import 名, pip 名, 是否必需, 用途)
DEPS = [
    ("docx", "python-docx", True, "Word 读写"),
    ("openpyxl", "openpyxl", True, "Excel 读写"),
    ("pptx", "python-pptx", True, "PPT 制作"),
    ("pymupdf", "PyMuPDF", True, "PDF 只读精确提取"),
    ("pdfplumber", "pdfplumber", True, "PDF 表格提取"),
    ("pypdf", "pypdf", True, "PDF 结构操作"),
    ("PIL", "Pillow", True, "图片处理（页面转图/内嵌图）"),
    ("win32com", "pywin32", True, "WPS COM 调用（Windows）"),
    ("fontTools", "fontTools", False, "保留项：当前无子命令使用（autofit 已改用 Pillow 测量）"),
]

# WPS COM 可能出现的 ProgID（用户级 HKCU 或 WOW6432Node 注册，实测本机可用）
WPS_PROGIDS = ["KWPS.Application", "Word.Application", "Ket.Application", "KET.Application", "Kwpp.Application"]


def _run(cmd, timeout=20):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except Exception as e:  # noqa: BLE001
        return -1, str(e)


def check_python():
    """探测可用解释器：优先 py -3（Windows），再 python3 / python。"""
    info = {"ok": False, "launcher": None, "version": None, "evidence": "", "fix": ""}
    candidates = [["py", "-3"], ["python3"], ["python"]]
    for cmd in candidates:
        code, out = _run(cmd + ["-c", "import sys;print('%d.%d.%d' % sys.version_info[:3])"])
        text = out.strip().splitlines()[-1] if out.strip() else ""
        if code == 0 and text and text[0].isdigit():
            ver = tuple(int(x) for x in text.split(".")[:2])
            info.update({"launcher": " ".join(cmd), "version": text,
                         "ok": ver >= MIN_PYTHON, "evidence": " ".join(cmd) + " → " + text})
            if not info["ok"]:
                info["fix"] = ("解释器过旧：需 >= %s（由 PyMuPDF/fontTools 决定），建议装 %s：\n"
                               "      winget install -e --id Python.Python.%s\n"
                               "      或 https://www.python.org/downloads/windows/"
                               % (".".join(map(str, MIN_PYTHON)), RECOMMENDED, RECOMMENDED))
            return info
        # 识别 MS Store 别名 stub（Windows 常见坑）
        if "Python was not found" in out or "Microsoft Store" in out:
            info["evidence"] += ("[%s] 命中 MS Store 别名 stub（不是真解释器）\n      " % " ".join(cmd))
    info["fix"] = ("未找到可用 Python（>= %s，建议 %s）：\n"
                   "      winget install -e --id Python.Python.%s\n"
                   "      或 https://www.python.org/downloads/windows/"
                   % (".".join(map(str, MIN_PYTHON)), RECOMMENDED, RECOMMENDED))
    return info


def check_deps():
    rows = []
    import warnings
    for mod, pip_name, required, purpose in DEPS:
        try:
            with warnings.catch_warnings():
                # PyMuPDF 1.28+ 会对旧的 `import fitz` 发弃用警告；统一走 pymupdf 并静音
                warnings.simplefilter("ignore")
                m = importlib.import_module(mod)
            version = getattr(m, "__version__", "") or (getattr(m, "version", "") if mod == "pymupdf" else "")
            rows.append({"module": mod, "pip": pip_name, "required": required, "ok": True,
                         "version": str(version), "purpose": purpose})
        except Exception as e:  # noqa: BLE001
            # 兼容旧版 PyMuPDF：只有 fitz 没有 pymupdf
            if mod == "pymupdf":
                try:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        import fitz  # type: ignore
                    rows.append({"module": "fitz", "pip": pip_name, "required": required, "ok": True,
                                 "version": str(getattr(fitz, "VersionBind", "")), "purpose": purpose})
                    continue
                except Exception:
                    pass
            rows.append({"module": mod, "pip": pip_name, "required": required, "ok": False,
                         "version": "", "purpose": purpose, "error": str(e)[:120]})
    return rows


def check_wps():
    """检测 WPS COM 是否可实例化（比对/重算/透视/页码目录 全依赖它）。"""
    import_info = check_deps()
    if not any(r["module"] == "win32com" and r["ok"] for r in import_info):
        return {"ok": False, "evidence": "pywin32 未装，无法检测 COM", "progid": None,
                "fix": "先装 pywin32：py -3 -m pip install pywin32"}
    if platform.system() != "Windows":
        return {"ok": False, "evidence": "非 Windows 平台，不支持 WPS COM", "progid": None,
                "fix": "本模块的比对/重算/透视等功能在非 Windows 上不可用"}
    try:
        import win32com.client as wc  # type: ignore
        import pythoncom  # type: ignore
        pythoncom.CoInitialize()
        for progid in WPS_PROGIDS:
            try:
                app = wc.Dispatch(progid)
                try:
                    app.Quit()
                except Exception:
                    pass
                return {"ok": True, "evidence": "可实例化：" + progid, "progid": progid, "fix": ""}
            except Exception:
                continue
        return {"ok": False, "evidence": "试过 " + ", ".join(WPS_PROGIDS) + " 均失败", "progid": None,
                "fix": "安装 WPS Office（本模块硬前置）：https://www.wps.cn/  （Microsoft Office 亦可，但未经验证）"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "evidence": str(e)[:120], "progid": None, "fix": "检查 pywin32 安装"}


def main():
    ap = argparse.ArgumentParser(description="dsh-doc-suite 环境自检")
    ap.add_argument("--json", action="store_true", help="输出 JSON（供插件解析）")
    ap.add_argument("--fix", action="store_true", help="执行 pip 安装缺失的库（不安装解释器）")
    ap.add_argument("--skip-wps", action="store_true", help="跳过 WPS COM 检查")
    ap.add_argument("--emit-skill-paths", action="store_true",
                    help="只输出脚本/技能绝对路径 JSON（供技能文档解析 <DOC_SUITE_SCRIPTS> 占位符）")
    args = ap.parse_args()

    if args.emit_skill_paths:
        py = check_python()
        print(json.dumps({
            "moduleDir": str(MODULE_DIR),
            "scriptsDir": str(SCRIPTS_DIR),
            "skillsDir": str(SKILLS_DIR),
            "pythonLauncher": py["launcher"] if py["ok"] else (sys.executable or "py -3"),
            "tools": {k: str(SCRIPTS_DIR / v) for k, v in TOOL_FILES.items()},
            "skills": {d.name: str(d / "SKILL.md") for d in sorted(SKILLS_DIR.iterdir())
                       if d.is_dir()} if SKILLS_DIR.is_dir() else {},
        }, ensure_ascii=False, indent=2))
        return 0

    py = check_python()
    deps = check_deps()
    wps = None if args.skip_wps else check_wps()

    missing = [d["pip"] for d in deps if not d["ok"] and d["required"]]
    missing_opt = [d["pip"] for d in deps if not d["ok"] and not d["required"]]
    fix_cmd = ""
    if missing:
        fix_cmd = py["launcher"] + " -m pip install " + " ".join(missing) if py["ok"] else "（先解决 Python 解释器）"
    fix_cmd_opt = ""
    if missing_opt and py["ok"]:
        fix_cmd_opt = py["launcher"] + " -m pip install " + " ".join(missing_opt)

    if args.json:
        print(json.dumps({
            "python": py, "deps": deps, "wps": wps,
            "missing_required": missing, "missing_optional": missing_opt,
            "fix_command": fix_cmd, "fix_command_optional": fix_cmd_opt,
            "ready": bool(py["ok"] and not missing and (args.skip_wps or (wps or {}).get("ok"))),
        }, ensure_ascii=False, indent=2))
        return 0

    print("=" * 62)
    print("dsh-doc-suite 环境自检（doctor）")
    print("=" * 62)
    print("\n[1] Python 解释器")
    print("    " + ("✅ " if py["ok"] else "❌ ") + (py["evidence"] or "未找到"))
    if py["fix"]:
        print("    修复：\n      " + py["fix"])

    print("\n[2] 依赖库")
    for d in deps:
        flag = "✅" if d["ok"] else ("❌" if d["required"] else "⚠️ ")
        tag = "必需" if d["required"] else "可选"
        ver = (" v" + d["version"]) if d["version"] else ""
        print("    %s %-12s [%s]%s  %s" % (flag, d["pip"], tag, ver, d["purpose"]))
    if fix_cmd:
        print("\n    缺必需库，修复命令：\n      " + fix_cmd)
    if fix_cmd_opt:
        print("    可选补强（推荐）：\n      " + fix_cmd_opt)

    if wps is not None:
        print("\n[3] WPS Office（硬前置：比对/重算/透视/页码目录依赖它）")
        print("    " + ("✅ " if wps["ok"] else "❌ ") + wps["evidence"])
        if wps["fix"]:
            print("    修复：" + wps["fix"])

    ok = py["ok"] and not missing and (args.skip_wps or (wps or {}).get("ok"))
    print("\n" + "-" * 62)
    print("结论：" + ("✅ 环境就绪，文档四格式能力可用" if ok else "❌ 环境未就绪，请按上面的修复命令补齐"))
    print("-" * 62)

    if args.fix and (missing or missing_opt) and py["ok"]:
        pkgs = missing + missing_opt
        print("\n[--fix] 执行：" + py["launcher"] + " -m pip install " + " ".join(pkgs))
        code, out = _run(py["launcher"].split() + ["-m", "pip", "install"] + pkgs, timeout=600)
        print(out[-2000:])
        print("退出码：" + str(code))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
