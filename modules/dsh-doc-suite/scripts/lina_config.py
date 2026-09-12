"""lina 共享配置加载：合并 E:\\lina\\.lina\\config.json 与环境变量覆盖。"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # E:\lina
CONFIG_PATH = ROOT / ".lina" / "config.json"

DEFAULTS = {
    "vision": {
        "provider": "openai-compatible",
        "baseUrl": "",
        "apiKey": "",
        "model": "",
        "timeoutSeconds": 180,
        "maxImageSize": 1600,
    },
    "ocr": {
        "provider": "zhipu-layout-parsing",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
        "apiKey": "",
        "model": "glm-ocr",
        "enabled": True,
    },
    "knowledgeBase": str(ROOT / "knowledge-base"),
    "knowledgeBases": {},  # 多库：{库名: 路径}，由 config.json 提供；main 回退到 knowledgeBase
    "scriptsRoot": str(ROOT / "scripts"),
    "office": {"useWpsCom": True},
}

_ENV_OVERRIDES = {
    "vision.baseUrl": "LINA_VISION_BASE_URL",
    "vision.apiKey": "LINA_VISION_API_KEY",
    "vision.model": "LINA_VISION_MODEL",
    "ocr.baseUrl": "LINA_OCR_BASE_URL",
    "ocr.apiKey": "LINA_OCR_API_KEY",
    "ocr.model": "LINA_OCR_MODEL",
}


def _deep_merge(base, patch):
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def _set_path(cfg, dotted, value):
    parts = dotted.split(".")
    node = cfg
    for part in parts[:-1]:
        node = node.setdefault(part, {})
    node[parts[-1]] = value


def load():
    """返回配置字典（含默认值；已合并 config.json 与环境变量）。"""
    cfg = json.loads(json.dumps(DEFAULTS))
    if CONFIG_PATH.exists():
        try:
            user = json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig"))
            _deep_merge(cfg, user)
        except Exception as exc:  # noqa: BLE001 - 配置损坏不应阻断脚本
            print(f"[warn] 无法读取 {CONFIG_PATH}: {exc}", file=sys.stderr)
    for dotted, var in _ENV_OVERRIDES.items():
        value = os.environ.get(var)
        if value:
            _set_path(cfg, dotted, value)
    return cfg
