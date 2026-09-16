#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ARK（火山方舟）生图 —— B 线施工 ⑥（图形元素优先生图，失败可回退代码矢量）。

设计依据：55 号第七章。要点：
  - **默认接入火山引擎（ARK）**；密钥走 **环境变量 ARK_API_KEY**（--api-key 优先），或由宿主把设置项注入环境变量；
  - 密钥**不打印、不落日志、不进报错文本**（只报告「已配置 / 未配置」）；
  - 任何失败（无密钥 / 模型未开通 / 限流 / 超时 / 网络）→ 退出码 **4**（**可回退**：调用方改用代码矢量绘制）；
  - 生图是**云端服务**：调用前打印一行显式告知（prompt 会发送到该服务）。

命令：
  py -3 gen_image.py image --prompt <文本> --out <路径> [--ref <参考图>] [--size 1K]
                           [--model <模型ID>] [--endpoint URL] [--timeout-ms 60000] [--retries 2]
                           [--api-key KEY]
  py -3 gen_image.py check [--endpoint URL]     # 只报告配置状态（不调用云端、不回显密钥）

退出码：0 成功 ｜ 2 参数/输入错 ｜ 4 云端不可用或调用失败（可回退）
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
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

DEFAULT_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3"
DEFAULT_MODEL = "doubao-seedream-5-0-pro-260628"
EXIT_FALLBACK = 4
_MAX_REF_BYTES = 10 * 1024 * 1024


def _api_key(args):
    return (getattr(args, "api_key", None) or os.environ.get("ARK_API_KEY") or "").strip()


def _endpoint(args):
    return (getattr(args, "endpoint", None) or os.environ.get("ARK_ENDPOINT")
            or DEFAULT_ENDPOINT).rstrip("/")


def _host(url):
    try:
        return urllib.parse.urlparse(url).netloc or url
    except Exception:
        return url


def _data_uri(path):
    p = Path(path)
    if not p.is_file():
        raise cli_guard.InputError("参考图不存在: %s" % p)
    raw = p.read_bytes()
    if len(raw) > _MAX_REF_BYTES:
        raise cli_guard.InputError("参考图过大（%d 字节 > 上限 %d）：请先压缩" % (len(raw), _MAX_REF_BYTES))
    mime = mimetypes.guess_type(str(p))[0] or "image/png"
    return "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii"))


def _post_json(url, key, body, timeout_s):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def _explain_http_error(exc, model, endpoint):
    """HTTP 错误 → （中文原因, 是否可重试）；**绝不回显密钥**。"""
    code = ""
    message = ""
    try:
        raw = exc.read().decode("utf-8", "replace")
        payload = json.loads(raw)
        err = payload.get("error") or payload
        code = str(err.get("code") or err.get("type") or "")
        message = str(err.get("message") or "")[:200]
    except Exception:
        pass
    if not code:
        code = "HTTP %s" % getattr(exc, "code", "?")
    hint = {
        "ModelNotOpen": "模型未开通：请到火山方舟控制台开通该模型（%s）" % model,
        "SetLimitExceeded": "触发限额（方舟「安心体验模式」限额）：请在控制台调整后再试",
        "AuthenticationError": "鉴权失败：请检查 ARK_API_KEY 是否有效",
        "InvalidParameter": "参数不合法：请检查 --size / --prompt 是否被服务接受",
    }.get(code, "云端返回错误：%s %s（端点 %s）" % (code, message, _host(endpoint)))
    retryable = str(getattr(exc, "code", "")) in ("429", "500", "502", "503", "504")
    return hint, retryable


def _download_bytes(url, timeout_s, retries):
    """下载图片字节（**不落盘** —— 落盘统一走 _save_image 做格式校验）。"""
    last = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout_s) as resp:
                return resp.read(), None
        except Exception as exc:                     # noqa: BLE001
            last = exc
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    return None, last


_IMAGE_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "PNG", ".png"),
    (b"\xff\xd8\xff", "JPEG", ".jpg"),
    (b"GIF87a", "GIF", ".gif"),
    (b"GIF89a", "GIF", ".gif"),
)


def detect_image_format(raw):
    """按文件头判断真实图片格式。

    实测（2026-09-16）：方舟返回的**实际是 JPEG**，若按 §--out xxx.png§ 直接落盘，
    会得到「扩展名是 png、字节是 jpeg」的假 PNG（下游识图/排版会报格式不符）。
    """
    for magic, name, ext in _IMAGE_MAGIC:
        if raw.startswith(magic):
            return name, ext
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "WEBP", ".webp"
    return None, None


def _save_image(raw, out):
    """按 --out 声明的扩展名落盘；**实际格式不符则转码**（缺 Pillow 则改名落盘并告警）。

    返回 (实际写入路径, 说明)。
    """
    fmt, ext = detect_image_format(raw)
    want = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP", ".gif": "GIF"}.get(out.suffix.lower())
    out.parent.mkdir(parents=True, exist_ok=True)
    if fmt is None or want is None or fmt == want:
        out.write_bytes(raw)
        return out, ("" if fmt is None else "（实际格式 %s）" % fmt)
    try:
        import io
        from PIL import Image
        im = Image.open(io.BytesIO(raw))
        if want == "JPEG":
            im.convert("RGB").save(out, want, quality=95)
        else:
            im.save(out, want)
        return out, "（云端返回 %s，已转码为 %s）" % (fmt, want)
    except Exception as exc:                         # noqa: BLE001
        alt = out.with_suffix(ext)
        alt.write_bytes(raw)
        return alt, "（云端返回 %s，且缺 Pillow 无法转码：%s）" % (fmt, type(exc).__name__)


def cmd_check(args):
    key = _api_key(args)
    endpoint = _endpoint(args)
    print("provider : volcengine-ark")
    print("endpoint : %s（%s）" % (endpoint, _host(endpoint)))
    print("model    : %s" % (getattr(args, "model", None) or DEFAULT_MODEL))
    print("密钥状态 : %s" % ("已配置（长度 %d，不回显）" % len(key) if key else "未配置 → 生图不可用，将回退代码矢量绘制"))
    print("说明     : 密钥来源 = --api-key > 环境变量 ARK_API_KEY；本命令**不调用云端**。")
    return 0


def cmd_image(args):
    key = _api_key(args)
    endpoint = _endpoint(args)
    model = args.model or os.environ.get("ARK_MODEL") or DEFAULT_MODEL
    out = Path(args.out)
    prompt = str(args.prompt or "").strip()
    if not prompt:
        raise cli_guard.InputError("--prompt 不能为空")
    print("提示: 生图为云端服务（%s），prompt 将发送到该服务；请勿包含客户信息、报价或涉密内容。"
          % _host(endpoint))
    if not key:
        print("错误: 未配置 ARK_API_KEY（也没给 --api-key）→ 生图不可用。", file=sys.stderr)
        print("提示: 这是**可回退**情形（exit %d）——调用方应改用代码矢量绘制；"
              "如需生图，请在设置页填写密钥或设置环境变量 ARK_API_KEY。" % EXIT_FALLBACK, file=sys.stderr)
        return EXIT_FALLBACK

    body = {"model": model, "prompt": prompt, "size": str(args.size or "1K"), "response_format": "url"}
    if args.ref:
        body["image"] = _data_uri(args.ref)          # 参考图（保身份/画风）：data URI 直传
    url = endpoint + "/images/generations"
    timeout_s = max(5.0, float(args.timeout_ms) / 1000.0)
    print("请求: model=%s size=%s prompt=%d 字%s"
          % (model, body["size"], len(prompt), "（含参考图）" if args.ref else ""))

    payload = None
    for attempt in range(int(args.retries) + 1):
        try:
            payload = _post_json(url, key, body, timeout_s)
            break
        except urllib.error.HTTPError as exc:
            hint, retryable = _explain_http_error(exc, model, endpoint)
            if retryable and attempt < int(args.retries):
                time.sleep(1.5 * (attempt + 1))
                continue
            print("错误: %s" % hint, file=sys.stderr)
            print("提示: 云端不可用（exit %d，可回退代码矢量绘制）。" % EXIT_FALLBACK, file=sys.stderr)
            return EXIT_FALLBACK
        except Exception as exc:                     # noqa: BLE001（含超时、DNS、连接失败）
            if attempt < int(args.retries):
                time.sleep(1.5 * (attempt + 1))
                continue
            print("错误: 网络或超时问题：%s" % type(exc).__name__, file=sys.stderr)
            print("提示: 云端不可用（exit %d，可回退代码矢量绘制）。" % EXIT_FALLBACK, file=sys.stderr)
            return EXIT_FALLBACK

    item = ((payload or {}).get("data") or [{}])[0]
    b64 = item.get("b64_json")
    link = item.get("url")
    if b64:
        raw = base64.b64decode(b64)
    elif link:
        raw, exc = _download_bytes(link, timeout_s, int(args.retries))
        if raw is None:
            print("错误: 图片下载失败：%s" % type(exc).__name__, file=sys.stderr)
            print("提示: 云端不可用（exit %d，可回退代码矢量绘制）。" % EXIT_FALLBACK, file=sys.stderr)
            return EXIT_FALLBACK
    else:
        print("错误: 云端响应里没有图片数据（既无 b64_json 也无 url）。", file=sys.stderr)
        return EXIT_FALLBACK
    written, note = _save_image(raw, out)
    print("OK: 已生成 %s（%d 字节 · 模型 %s）%s" % (written, written.stat().st_size, model, note))
    return 0


def main():
    parser = argparse.ArgumentParser(description="ARK（火山方舟）生图")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("image", help="生成一张图（失败/无密钥 → exit 4，可回退）")
    p.add_argument("--prompt", required=True, help="提示词（勿含客户信息 / 报价 / 涉密内容）")
    p.add_argument("--out", required=True, help="输出图片路径（.png/.jpg）")
    p.add_argument("--ref", help="参考图路径（保身份 / 画风）")
    p.add_argument("--size", default="1K", help="尺寸（方舟口径，如 1K / 2K；默认 1K）")
    p.add_argument("--model", help="模型 ID（默认 %s）" % DEFAULT_MODEL)
    p.add_argument("--endpoint", help="方舟端点（默认 %s）" % DEFAULT_ENDPOINT)
    p.add_argument("--timeout-ms", dest="timeout_ms", type=int, default=60000, help="单次请求超时（毫秒）")
    p.add_argument("--retries", type=int, default=2, help="失败重试次数（默认 2；4xx 不重试）")
    p.add_argument("--api-key", dest="api_key", help="密钥（优先于环境变量 ARK_API_KEY；不会出现在输出里）")
    p.set_defaults(fn=cmd_image)

    p = sub.add_parser("check", help="报告密钥与端点配置状态（不调用云端）")
    p.add_argument("--endpoint")
    p.add_argument("--model")
    p.set_defaults(fn=cmd_check)

    args = parser.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(cli_guard.run(main))
