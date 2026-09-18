# -*- coding: utf-8 -*-
"""统一 CLI 守卫：输入校验 + 异常友好化（杜绝裸 Traceback）。

背景（2026-09-12 完整测试结论）：四个工具在输入异常时抛裸 Traceback，其中走 WPS COM 的还
只给 COM 错误码（如 `(-2147352567, '发生意外。', (0, 'Kingsoft WPS', '文档打开失败。', 3010, ...))`），
对"主对话派单、子代理执行"的用法伤害最大——执行方无法据此自纠。

两件事：
  1. `check_inputs()`：按参数名自动校验输入文件是否存在（缺失 → 中文单行错误 + exit 2）。
  2. `run()`：兜住未预期异常，转成"错误: <中文说明>" + 一行"提示"，**不打印堆栈**；
     设 `DOC_SUITE_DEBUG=1` 时保留完整堆栈（供排障）。

风格对齐 `excel_tool.py pivot` 子命令既有的"中文结论 + 替代做法 + 专用退出码"写法。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

DEBUG_ENV = "DOC_SUITE_DEBUG"
EXIT_INPUT = 2

# 各工具中代表"输入文件"的参数名（argparse 会把 --from-md 变成 from_md）
INPUT_ATTRS = ("file", "src", "pdf", "files", "images", "doc_a", "doc_b",
               "from_md", "from_csv", "template", "manifest")

_LABELS = {
    "doc_a": "文档 A",
    "doc_b": "文档 B",
    "files": "输入文件",
    "images": "输入图片",
    "from_md": "Markdown 源文件",
    "from_csv": "CSV 源文件",
    "template": "模板文件",
    "manifest": "manifest 源文件",
}


class InputError(Exception):
    """使用者层面的输入错误（友好打印，不打印堆栈）。"""


def _label(name: str) -> str:
    return _LABELS.get(name, "输入文件")


def require_file(path, label: str = "输入文件"):
    """路径不存在或不是文件 → 抛 InputError。"""
    p = Path(path)
    if p.is_dir():
        raise InputError(f"{label}是目录而非文件: {p}")
    if not p.exists():
        raise InputError(f"{label}不存在: {p}")
    return p


def check_inputs(args) -> None:
    """按 INPUT_ATTRS 校验参数里的输入文件。

    `creates_file=True` 的子命令（如 excel write）跳过 file 本体的存在性校验
    （它允许新建），但其它输入（--from-csv）仍会校验。
    """
    skip = {"file"} if getattr(args, "creates_file", False) else set()
    for name in INPUT_ATTRS:
        if name in skip:
            continue
        value = getattr(args, name, None)
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            for item in value:
                require_file(item, _label(name))
        else:
            require_file(value, _label(name))


def _com_detail(exc):
    """从 pywintypes.com_error 里抽出人类可读的部分。"""
    try:
        parts = getattr(exc, "args", ())
        detail = parts[2] if len(parts) > 2 and parts[2] else ()
        text = detail[2] if len(detail) > 2 and detail[2] else str(exc)
        code = detail[4] if len(detail) > 4 and detail[4] else None
        return text, code
    except Exception:  # noqa: BLE001
        return str(exc), None


def _friendly(exc: Exception):
    """异常 → (中文说明, 提示或 None)。"""
    if isinstance(exc, InputError):
        return str(exc), None

    name = type(exc).__name__
    msg = str(exc).strip()

    if name == "com_error":
        text, code = _com_detail(exc)
        tail = f"（WPS 错误码 {code}）" if code else ""
        return (f"WPS 打开/处理文件失败: {text}{tail}",
                "常见原因：路径写错、文件正被 WPS 占用、文件损坏、扩展名与实际格式不符；"
                "确认后重试，或先用 summary / info 读一下该文件。")
    if name in ("PackageNotFoundError", "FileNotFoundError", "FileDataError"):
        return (f"文件不存在或不是有效的文档: {msg}",
                "请核对路径与文件格式（.docx/.pptx/.xlsx/.pdf）。")
    if name == "InvalidFileException":
        return (f"文件格式不受支持: {msg}",
                ".xls 旧格式请走 convert / recalc / summary（WPS COM 通道），openpyxl 只吃 .xlsx/.xlsm。")
    if name == "SpecError":
        # style_spec.SpecError（规格缺字段 / 跨格式误用等）：消息本身已是中文单行
        return (msg, None)
    if name == "KeyError":
        return (f"找不到对象: {msg}",
                "工作表名或字段名可能写错；先用 summary（Excel）/ info 确认可用名称。")
    if name == "PermissionError":
        return (f"文件被占用或无权限: {msg}",
                "请先关闭 WPS/Excel 中打开的该文件，或换一个有写权限的输出目录。")
    if name == "JSONDecodeError":
        return (f"JSON 解析失败: {msg}", "配置或输入文件内容不是合法 JSON。")
    return (f"{name}: {msg}" if msg else name,
            f"设置 {DEBUG_ENV}=1 可查看完整堆栈。")


def run(main_fn):
    """包裹各工具的 main()：未预期异常 → 中文单行错误 + exit 2。"""
    try:
        return main_fn()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        print("已中断。", file=sys.stderr)
        return 130
    except Exception as exc:  # noqa: BLE001
        if os.environ.get(DEBUG_ENV):
            raise
        message, hint = _friendly(exc)
        print(f"错误: {message}", file=sys.stderr)
        if hint:
            print(f"提示: {hint}", file=sys.stderr)
        return EXIT_INPUT
