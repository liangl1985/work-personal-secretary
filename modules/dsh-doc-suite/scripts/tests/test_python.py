#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-doc-suite · Python 侧单元测试（零第三方依赖，CI 与离线都能跑）

覆盖（全部是纯逻辑，不碰 WPS、不读使用者目录）：
  [A] 对比度    ppt_contrast            —— 黑白 21:1 / 同色 1:1 / 对称性 / is_hex6 边界 / 非法色值拒绝
  [B] 主题压暗  ppt_theme.darken_to_aa  —— 达标返回 True 且对白底与备用底都 >=4.5；非法输入返回 (原值,1.0,False)
  [C] 深度合并  spec_sync.deep_merge    —— 对象深度覆盖、数组整体替换、不改原对象
  [D] 规格校验  spec_sync.validate      —— 合法规格通过；缺 styles / pptx 几何越界 → SystemExit(2)；extends 派生件合并后通过
  [E] 随包模板  specs/*.json           —— 全部内置规格校验通过；report 与 WPS 三套（dusk/azure/crimson）的 accent 与 pptx 几何完整

用法：
  py -3 modules/dsh-doc-suite/scripts/tests/test_python.py
  py -3 -m unittest discover -s modules/dsh-doc-suite/scripts/tests -p 'test_*.py'
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
OFFICE = SCRIPTS / 'office'
SPECS = SCRIPTS.parent / 'specs'
for _p in (str(SCRIPTS), str(OFFICE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import ppt_contrast  # noqa: E402
import ppt_theme  # noqa: E402
import spec_sync  # noqa: E402


def _standard():
    return json.loads((SPECS / 'standard.json').read_text(encoding='utf-8'))


class TestContrast(unittest.TestCase):
    def test_extremes(self):
        self.assertAlmostEqual(ppt_contrast.ratio('000000', 'FFFFFF'), 21.0, delta=0.05)
        self.assertAlmostEqual(ppt_contrast.ratio('FFFFFF', 'FFFFFF'), 1.0, delta=0.001)

    def test_symmetry_and_hash_prefix(self):
        self.assertAlmostEqual(ppt_contrast.ratio('1F4E79', 'FFFFFF'),
                               ppt_contrast.ratio('#FFFFFF', '#1F4E79'), places=6)

    def test_is_hex6(self):
        for good in ('A34A00', '#a34a00', ' 1F4E79 '):
            self.assertTrue(ppt_contrast.is_hex6(good), good)
        for bad in ('accent', 'A34A0', 'GGGGGG', '', None, 123456):
            self.assertFalse(ppt_contrast.is_hex6(bad), repr(bad))

    def test_luminance_rejects_bad(self):
        with self.assertRaises(Exception):
            ppt_contrast.luminance('XYZ')


class TestDarken(unittest.TestCase):
    def test_reaches_aa_on_both_backgrounds(self):
        cand, factor, ok = ppt_theme.darken_to_aa('6096E6')
        self.assertTrue(ok)
        self.assertLess(factor, 1.0)
        for bg in ('FFFFFF', 'F2F2F2'):
            self.assertGreaterEqual(ppt_contrast.ratio(cand, bg), 4.5)

    def test_bad_input(self):
        cand, factor, ok = ppt_theme.darken_to_aa('not-a-color')
        self.assertFalse(ok)
        self.assertEqual(cand, 'not-a-color')
        self.assertEqual(factor, 1.0)


class TestMerge(unittest.TestCase):
    def test_deep_merge(self):
        a = {'x': {'y': 1, 'z': 2}, 'k': [1, 2]}
        b = {'x': {'y': 9}, 'k': [3]}
        m = spec_sync.deep_merge(a, b)
        self.assertEqual(m['x']['y'], 9)
        self.assertEqual(m['x']['z'], 2)
        self.assertEqual(m['k'], [3], '数组应整体替换')
        self.assertEqual(a['x']['y'], 1, '不应改原对象')


class TestValidate(unittest.TestCase):
    def test_standard_passes(self):
        s = _standard()
        self.assertTrue(spec_sync.validate('standard', s, {'standard': s}))

    def test_missing_styles(self):
        s = _standard()
        s['word'].pop('styles', None)
        with self.assertRaises(SystemExit) as cm:
            spec_sync.validate('probe', s, {'probe': s})
        self.assertEqual(cm.exception.code, 2)

    def test_pptx_out_of_bounds(self):
        s = _standard()
        s['pptx']['layouts']['cover']['elements'][0]['box']['x'] = 99
        with self.assertRaises(SystemExit):
            spec_sync.validate('probe', s, {'probe': s})

    def test_govdoc_extends_passes(self):
        g = json.loads((SPECS / 'govdoc.json').read_text(encoding='utf-8'))
        std = _standard()
        self.assertTrue(spec_sync.validate('govdoc', g, {'standard': std, 'govdoc': g}))


class TestBuiltinSpecs(unittest.TestCase):
    """随包内置模板（specs/*.json）：全部可校验、几何完整；report 与 WPS 三套强调色固定。"""

    EXTRA = {'report': 'A34A00', 'dusk': '4F6C97', 'azure': '0060E0', 'crimson': 'BC0300'}

    def _files(self):
        out = {}
        for p in sorted(SPECS.glob('*.json')):
            if p.name.endswith('.schema.json'):
                continue
            out[p.stem] = json.loads(p.read_text(encoding='utf-8'))
        return out

    def test_all_builtin_specs_pass_validation(self):
        specs = self._files()
        pool = {'standard': _standard()}
        pool.update(specs)
        for spec_id, raw in specs.items():
            self.assertTrue(spec_sync.validate(spec_id, raw, pool), spec_id)

    def test_new_templates_accent_and_pptx_geometry(self):
        std = _standard()
        specs = self._files()
        for spec_id, accent in self.EXTRA.items():
            self.assertIn(spec_id, specs, '内置模板缺失：specs/%s.json' % spec_id)
            raw = {k: v for k, v in specs[spec_id].items() if k != 'extends'}
            merged = spec_sync.deep_merge(std, raw)
            self.assertEqual(merged['colors']['accent'], accent, spec_id + ' 强调色不符')
            pptx = merged.get('pptx') or {}
            for key in ('layouts', 'components', 'slide', 'fonts'):
                self.assertIn(key, pptx, spec_id + ' 缺 pptx.' + key)
            layouts = [k for k in pptx['layouts'] if not k.startswith('_')]
            self.assertEqual(len(layouts), 16, spec_id + ' 页型应为 16 类，实得 %d' % len(layouts))


if __name__ == '__main__':
    unittest.main(verbosity=2)
