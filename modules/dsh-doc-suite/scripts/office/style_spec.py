# -*- coding: utf-8 -*-
"""样式规格（style spec）加载 + 内容零改动断言 —— A 线样式能力共享层。

设计要点（2026-09-15 定，见 02_分析笔记/28、33、34）：
  1. 规格只用**标准库 json**（本机未装 pyyaml，本项目红线＝零新增依赖）。
  2. 两层：内置默认（模块 specs/）< 使用者自定义（~/.dsh/data/dsh-doc-suite/templates/），
     同名键**深度覆盖**，与 DSH 原生设置"schema 默认 ← base ← 用户覆盖"同构。
  3. **内容零改动断言**：套样式前后逐段（Word）/ 逐单元格（Excel，含公式）比对，
     任何差异 → 抛 ContentChangedError，调用方**必须拒绝产出且不动原文件**。
     （红线来源：34 号实测 gongwen 会吞正文空格、把"3,242,802.00 元"变成"…元"。）
"""
from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

BUILTIN_DIR = Path(__file__).resolve().parents[2] / "specs"
USER_DIR = Path.home() / ".dsh" / "data" / "dsh-doc-suite" / "templates"
DEFAULT_SPEC = "standard"


class SpecError(Exception):
    """规格文件缺失/格式错误（使用者层面，友好打印）。"""


class ContentChangedError(Exception):
    """内容发生了改动 —— 断言失败，必须拒绝产出。"""

    exit_code = 3


# ---------------------------------------------------------------- 规格加载

def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SpecError(f"规格不是合法 JSON: {path}（{exc}）") from exc
    if not isinstance(data, dict):
        raise SpecError(f"规格根节点必须是对象: {path}")
    return data


def deep_merge(base: dict, override: dict) -> dict:
    """深度合并：override 覆盖 base，dict 递归，其它类型整体替换。"""
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def _load_by_id(spec_id: str, _seen: set | None = None) -> dict:
    """按 id 加载规格。

    顺序：内置 specs/<id>.json → 使用者自定义层同名覆盖 → 若声明 extends 则递归继承基座。
    （A3 起支持 extends：派生风格只需写差异键，便于维护。）
    """
    _seen = _seen if _seen is not None else set()
    if spec_id in _seen:
        raise SpecError(f"规格 extends 出现循环：{spec_id}")
    _seen.add(spec_id)
    builtin = BUILTIN_DIR / f"{spec_id}.json"
    user = USER_DIR / f"{spec_id}.json"
    raw: dict = {}
    if builtin.exists():
        raw = _read_json(builtin)
    if user.exists():
        raw = deep_merge(raw, _read_json(user))
    if not raw:
        raise SpecError(
            f"找不到规格 {spec_id!r}：内置目录 {BUILTIN_DIR} 与自定义目录 {USER_DIR} 均无 {spec_id}.json"
        )
    base_id = raw.get("extends")
    if base_id:
        base = _load_by_id(str(base_id), _seen)
        raw = {k: v for k, v in raw.items() if k != "extends"}
        merged = deep_merge(base, raw)
        merged.setdefault("id", spec_id)
        return merged
    return raw


def load_spec(spec_arg: str | None = None) -> dict:
    """spec_arg 可以是：内置 id（standard）/ 自定义 id / 规格文件路径。"""
    name = (spec_arg or DEFAULT_SPEC).strip()
    path = Path(name)
    if path.exists() and path.is_file():
        data = _read_json(path)
        base_id = data.get("extends")
        base = _load_by_id(base_id) if base_id else {}
        merged = deep_merge(base, data) if base else data
        merged.setdefault("id", base_id or path.stem)
        return merged
    return _load_by_id(name)


def describe_spec(spec: dict) -> str:
    cols = spec.get("colors", {})
    return (
        f"规格 {spec.get('id')}（{spec.get('name')}）"
        f" 主色#{cols.get('primary', '?')} 适用={','.join(spec.get('best_for', []) or [])}"
    )


# ---------------------------------------------------------------- 备份 / 就地改

def backup_file(path: Path, tag: str = "style") -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = path.with_name(f"{path.name}.bak-{tag}-{stamp}")
    shutil.copy2(path, bak)
    return bak


def resolve_output(src: Path, out_arg: str | None, tag: str = "style"):
    """返回 (输出路径, 备份路径或 None)。缺省就地改 + 备份。"""
    if out_arg:
        return Path(out_arg), None
    return src, backup_file(src, tag)


# ---------------------------------------------------------------- 内容快照 / 断言

def word_snapshot(path) -> dict:
    """Word 段落文本 + 表格单元格文本（不含格式）。"""
    from docx import Document

    doc = Document(str(path))
    paras = [p.text for p in doc.paragraphs]
    cells = [c.text for t in doc.tables for r in t.rows for c in r.cells]
    return {"paras": paras, "cells": cells}


def excel_snapshot(path) -> dict:
    """逐工作表逐单元格的**值/公式字符串**（data_only=False 保证公式原文可见）。"""
    from openpyxl import load_workbook

    wb = load_workbook(str(path), data_only=False)
    out: dict = {}
    try:
        for ws in wb.worksheets:
            rows = []
            for row in ws.iter_rows():
                rows.append([c.value for c in row])
            out[ws.title] = rows
    finally:
        wb.close()
    return out


def _diff_lines(before, after, kind: str, limit: int = 8):
    lines = []
    if kind == "word":
        for key in ("paras", "cells"):
            b, a = before.get(key, []), after.get(key, [])
            if b == a:
                continue
            label = "段落" if key == "paras" else "表格单元格"
            if len(b) != len(a):
                lines.append(f"{label}数量变化: {len(b)} → {len(a)}")
            for i, (x, y) in enumerate(zip(b, a)):
                if x != y:
                    lines.append(f"{label}#{i}: {x[:60]!r} → {y[:60]!r}")
                if len(lines) >= limit:
                    break
    else:
        for sheet in sorted(set(list(before.keys()) + list(after.keys()))):
            b, a = before.get(sheet), after.get(sheet)
            if b is None or a is None:
                lines.append(f"工作表变化: {sheet}")
                continue
            if len(b) != len(a):
                lines.append(f"[{sheet}] 行数变化: {len(b)} → {len(a)}")
            for ri, (rb, ra) in enumerate(zip(b, a), 1):
                if rb != ra:
                    for ci, (xb, xa) in enumerate(zip(rb, ra), 1):
                        if xb != xa:
                            lines.append(f"[{sheet}] R{ri}C{ci}: {xb!r} → {xa!r}")
                        if len(lines) >= limit:
                            break
                if len(lines) >= limit:
                    break
    return lines


def assert_content_unchanged(before, after, kind: str) -> None:
    """差异为 0 才通过；否则抛 ContentChangedError（调用方拒绝产出）。"""
    if before == after:
        return
    detail = _diff_lines(before, after, kind)
    shown = "\n    ".join(detail) if detail else "（差异存在但未能定位，请开 DOC_SUITE_DEBUG=1 排查）"
    raise ContentChangedError(
        "套样式前后【内容发生变化】，已拒绝产出、原文件未改动。差异：\n    " + shown
    )


def check_spec_supported(spec: dict) -> None:
    """本地文件格式与规格 id 的匹配校验（跨格式误用是最常见的返工来源）。"""
    sid = str(spec.get("id", ""))
    if not sid:
        raise SpecError("规格缺少 id 字段")
    if "word" not in spec and "excel" not in spec:
        raise SpecError(f"规格 {sid} 既不含 word 段也不含 excel 段，无法套用")


# ---------------------------------------------------------------- 安全落盘

def commit_style(src, out_arg, apply_fn, tag: str = "style"):
    """先写到临时文件 → 断言在临时文件上做 → 通过后才原子就位。

    断言失败时**原文件绝对不动**（临时文件在 finally 里清理）。
    返回 (report, 最终路径, 备份路径或 None)。
    """
    import os

    src = Path(src)
    out = Path(out_arg) if out_arg else src
    tmp = src.with_name(f"{src.stem}.tmp-style{src.suffix or ''}")
    try:
        report = apply_fn(tmp)
        if tmp.resolve() == out.resolve():
            return report, out, None
        if out != src:
            out.parent.mkdir(parents=True, exist_ok=True)
            os.replace(str(tmp), str(out))
            return report, out, None
        bak = backup_file(src, tag)
        os.replace(str(tmp), str(src))
        return report, src, bak
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
