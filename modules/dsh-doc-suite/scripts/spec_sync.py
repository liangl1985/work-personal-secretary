#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""规格同步与校验（dsh-doc-suite）

改完 specs/*.json 后跑一次，自动完成三件事：
  1) 校验：所有规格 JSON 合法 + 必需字段齐（extends 继承件放宽）
  2) 同步：复制到使用者运行副本（profile 的模块目录），并做 SHA256 校验
  3) 展示：把规格渲染成人类可读的 Markdown（供核对；可写入文件）

用法：
  py -3 spec_sync.py                        # 校验 + 同步 + 打印展示 Markdown
  py -3 spec_sync.py --doc-out spec.md      # 同时把展示文档写入指定文件
  py -3 spec_sync.py --check                # 只校验（CI 用），不写任何文件
  py -3 spec_sync.py --no-sync              # 跳过 profile 同步
  py -3 spec_sync.py --profile-root <dir>   # 指定 profile 里的模块目录（含 specs/）
  py -3 spec_sync.py --spec standard        # 只处理指定规格 id

退出码：0 成功 / 2 输入或规格错误 / 3 校验发现不一致
说明：本脚本**不含任何使用者私有路径**（展示文档输出由 --doc-out 指定，缺省打印到标准输出）。
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODULE = HERE.parent
SPECS = MODULE / "specs"
REQ_TOP = ("schema", "id", "word", "excel")
REQ_WORD = ("page", "fonts")
REQ_EXCEL = ("font", "header", "border", "print")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def die(msg, code=2):
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def load_specs(only=None):
    if not SPECS.is_dir():
        die("找不到 specs/ 目录：%s" % SPECS)
    out = {}
    for p in sorted(SPECS.glob("*.json")):
        try:
            s = json.loads(p.read_text(encoding="utf-8"))
        except Exception as exc:
            die("规格不是合法 JSON：%s（%s）" % (p.name, exc))
        if only and s.get("id") != only:
            continue
        out[p.name] = s
    if not out:
        die("specs/ 下没有匹配的规格文件" + ("（--spec %s）" % only if only else ""))
    return out


def validate(name, s):
    errs = []
    for k in ("schema", "id"):
        if k not in s:
            errs.append("缺顶层键 %s" % k)
    if "extends" in s:
        # 继承件（部分规格）：只校验自身覆盖段的结构，不要求字段齐全
        if not s.get("extends"):
            errs.append("extends 为空")
        for seg in ("word", "excel", "colors"):
            if seg in s and not isinstance(s[seg], dict):
                errs.append("%s 应为对象" % seg)
    else:
        # 完整规格：必需段与必需样式
        for k in ("word", "excel"):
            if k not in s:
                errs.append("缺顶层键 %s" % k)
        w = s.get("word") or {}
        for k in REQ_WORD:
            if k not in w:
                errs.append("word 缺 %s" % k)
        if not (w.get("styles") or {}).get("Normal"):
            errs.append("word.styles.Normal 缺失")
        e = s.get("excel") or {}
        for k in REQ_EXCEL:
            if k not in e:
                errs.append("excel 缺 %s" % k)
    if errs:
        die("规格 %s 校验失败：%s" % (name, "；".join(errs)))
    return True


def find_profile_specs(profile_root=None):
    if profile_root:
        p = Path(profile_root) / "specs"
        return p if p.is_dir() else None
    home = Path.home()
    for prof in ("desktop", "web"):
        p = home / ".dsh" / "profiles" / prof / "node_modules" / "dsh-doc-suite" / "specs"
        if p.is_dir():
            return p
    return None


def sync_specs(dst_dir, only=None):
    rows = []
    for p in sorted(SPECS.glob("*.json")):
        s = json.loads(p.read_text(encoding="utf-8"))
        if only and s.get("id") != only:
            continue
        d = Path(dst_dir) / p.name
        shutil.copy2(p, d)
        a, b = sha256(p), sha256(d)
        rows.append((p.name, a[:10], b[:10], a == b))
    return rows


_AMAP = {"justify": "两端对齐", "center": "居中", "left": "左", "right": "右", "both": "两端对齐"}


def _row(*cells):
    return "| " + " | ".join(str(c) for c in cells) + " |"


def render_doc(spec):
    s = spec
    w = s.get("word") or {}
    e = s.get("excel") or {}
    c = s.get("colors") or {}
    L = []
    A = L.append
    A("# 规格展示 · " + str(s.get("name", s.get("id"))) + "（" + str(s.get("id")) + "）")
    A("")
    A("> 由 spec_sync.py 自动生成；真相源为 specs/*.json，请改 JSON 后重新生成。")
    if s.get("extends"):
        A("> 本规格继承自：" + str(s.get("extends")) + "（仅列出自身覆盖项）")
    A("")
    A("## 基本信息")
    A("")
    A(_row("项", "值"))
    A("|---|---|")
    for k in ("id", "name", "version", "updated", "extends", "mood"):
        if s.get(k):
            A(_row(k, s[k]))
    if s.get("best_for"):
        A(_row("best_for（适用场合）", " / ".join(s["best_for"])))
    A("")
    p = w.get("page") or {}
    if p:
        m = p.get("margins_cm") or {}
        A("## 页面")
        A("")
        A(_row("纸型", str(p.get("size")) + " " + str(p.get("orientation"))))
        if m:
            A(_row("页边距(cm)", "上 " + str(m.get("top")) + " / 下 " + str(m.get("bottom")) + " / 左 " + str(m.get("left")) + " / 右 " + str(m.get("right"))))
        A("")
    fonts = w.get("fonts") or {}
    if fonts:
        A("## 字体")
        A("")
        A(_row("角色", "字体", "说明"))
        A("|---|---|---|")
        for k, v in fonts.items():
            A(_row(k, v.get("ea"), ("西文 " + str(v.get("latin"))) if v.get("latin") else ""))
        if w.get("allowed_fonts"):
            A(_row("allowed_fonts", ", ".join(w["allowed_fonts"]), "白名单外字体即拒绝产出"))
        A("")
    styles = w.get("styles") or {}
    if styles:
        A("## 段落样式")
        A("")
        A(_row("角色", "中文标识", "字号(pt)", "加粗", "对齐", "行距", "段前/段后", "缩进"))
        A("|---|---|---|---|---|---|---|---|")
        for k, v in styles.items():
            ind = []
            if v.get("first_line_chars"):
                ind.append("首行 " + str(v["first_line_chars"]) + " 字符")
            if v.get("hanging_chars"):
                ind.append("悬挂 " + str(v["hanging_chars"]) + " 字符")
            A(_row(k, v.get("size_name", "-"), v.get("size_pt"), "加粗" if v.get("bold") else "常规",
                   _AMAP.get(str(v.get("align")), v.get("align")), v.get("line_spacing"),
                   str(v.get("space_before_pt")) + "/" + str(v.get("space_after_pt")),
                   "；".join(ind) if ind else "无"))
        A("")
    t = w.get("table") or {}
    if t:
        h = t.get("header") or {}
        b = t.get("body") or {}
        bd = t.get("borders") or {}
        A("## 表格")
        A("")
        A(_row("项", "值"))
        A("|---|---|")
        A(_row("宽度模式", t.get("width_mode")))
        A(_row("表头", "底纹 " + str(h.get("shading")) + "、" + ("加粗" if h.get("bold") else "常规") + "、" + str(h.get("align"))))
        A(_row("表内文字", str(b.get("size_pt")) + "pt、" + str(b.get("align"))))
        A(_row("边框", str(bd.get("style")) + "、" + str(bd.get("size")) + "pt、" + str(bd.get("color"))))
        A(_row("跨页重复表头", t.get("repeat_header")))
        A("")
    if c:
        sem = c.get("semantic") or {}
        A("## 色板")
        A("")
        A(_row("角色", "色值", "用途"))
        A("|---|---|---|")
        A(_row("主色 primary", "#" + str(c.get("primary")), "标题 / 表头底纹"))
        A(_row("辅助 secondary", "#" + str(c.get("secondary")), "次级元素"))
        A(_row("强调 accent（文字）", "#" + str(c.get("accent")), "关键数据文字"))
        if c.get("accent_decor"):
            A(_row("强调 accent_decor（装饰）", "#" + str(c.get("accent_decor")), "底纹 / 线框 / 图表"))
        A(_row("语义-通过 pass", "#" + str(sem.get("pass")), "合格 / 正常"))
        A(_row("语义-风险 risk", "#" + str(sem.get("risk")), "不满足 / 风险"))
        A(_row("语义-注意 warn（文字）", "#" + str(sem.get("warn")), "待确认"))
        if sem.get("warn_decor"):
            A(_row("语义-注意 warn_decor", "#" + str(sem.get("warn_decor")), "底纹 / 线框"))
        A("")
    if e:
        f = e.get("font") or {}
        eh = e.get("header") or {}
        eb = e.get("border") or {}
        pr = e.get("print") or {}
        A("## Excel")
        A("")
        A(_row("项", "值"))
        A("|---|---|")
        A(_row("字体", str(f.get("name")) + " " + str(f.get("size")) + "pt" + ("（" + str(f.get("size_name")) + "）" if f.get("size_name") else "")))
        A(_row("表头", "底纹 " + str(eh.get("shading")) + "、加粗、居中、冻结 " + str(eh.get("freeze"))))
        A(_row("边框", str(eb.get("style")) + "（" + str(eb.get("scope")) + "）、颜色 " + str(eb.get("color"))))
        A(_row("打印", str(pr.get("paper")) + " " + str(pr.get("orientation")) + "、缩放 " + str(pr.get("fit_to_width")) + " 页宽"))
        A("")
    notes = [("%s.%s" % ("word", k), v) for k, v in w.items() if k.startswith("_note") and isinstance(v, str)]
    notes += [("%s.%s" % ("colors", k), v) for k, v in c.items() if k.startswith("_note") and isinstance(v, str)]
    if notes:
        A("## 内嵌说明")
        A("")
        for k, v in notes:
            A("- **" + k + "**：" + v)
        A("")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="dsh-doc-suite 规格：校验 / 同步 profile / 生成展示文档")
    ap.add_argument("--check", action="store_true", help="只校验，不写任何文件（CI 用）")
    ap.add_argument("--no-sync", action="store_true", help="不同步 profile 副本")
    ap.add_argument("--profile-root", help="profile 内模块目录（含 specs/）；缺省自动探测")
    ap.add_argument("--doc-out", help="规格展示 Markdown 输出路径；缺省打印到标准输出")
    ap.add_argument("--spec", help="只处理指定规格 id")
    args = ap.parse_args(argv)

    specs = load_specs(args.spec)
    for name, s in specs.items():
        validate(name, s)
    print("[1/3] 规格校验通过：%s" % "、".join(specs))

    if args.check:
        print("[2/3] --check：跳过同步与生成")
        print("[3/3] 完成")
        return 0

    if args.no_sync:
        print("[2/3] --no-sync：跳过 profile 同步")
    else:
        dst = find_profile_specs(args.profile_root)
        if dst is None:
            print("[2/3] 未找到 profile 副本目录（可用 --profile-root 指定）—— 跳过同步")
        else:
            rows = sync_specs(dst, args.spec)
            bad = [r for r in rows if not r[3]]
            for n, a, b, ok in rows:
                print("       %s  %s  %s  %s" % (n, a, b, "一致" if ok else "★不一致"))
            if bad:
                print("       → 同步后仍不一致，请检查写入权限", file=sys.stderr)
                return 3
            print("[2/3] 已同步 %d 个规格到 %s" % (len(rows), dst))

    want_doc = args.doc_out or (not args.check)
    if args.doc_out:
        blocks = [render_doc(s) for s in specs.values()]
        text = ("\n\n---\n\n").join(blocks)
        Path(args.doc_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.doc_out).write_text(text, encoding="utf-8")
        print("[3/3] 展示文档已写入：%s" % args.doc_out)
    else:
        for s in specs.values():
            print(render_doc(s))
        print("", file=sys.stderr)
        print("[3/3] 展示文档已打印到标准输出（用 --doc-out 可写入文件）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:
        print("spec_sync 失败：%s" % exc, file=sys.stderr)
        sys.exit(2)
