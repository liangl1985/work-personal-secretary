# work-personal-secretary

> **私人秘书集成体**（DeepSeek Harness 插件集合）。一个仓库、多个子项目，逐步整合成一套"主人的私人秘书"能力，最终按 DSH 最新版要求以一体化插件形态交付。

- 运行环境：**DSH Desktop 2.0.9** / host 运行时 **dsh 0.1.5-rc.1**（cordis bundle 体系）
- 设计目标：**一个包、一个设置入口、一个面板**；子项目可独立开发/验收，再由根层整合
- 发布姿态：**暂不发布 npm**；整合完成、验收通过后再议

## 子项目

| 子项目 | 包名 | 状态 | 说明 |
|---|---|---|---|
| [`modules/dsh-lina-memory`](modules/dsh-lina-memory) | `dsh-lina-memory` | ✅ 可用（v1.0.1） | 执行层长期记忆：**三级记忆模型**（全局永不遗忘 / 热记忆按 TTL 转冷 / 冷归档被用到即转热）+ **转冷预审** + 会话原生注入 + `remember`/`recall`/`link` 工具 + 右侧边栏面板 + Obsidian 镜像。运行时 id 为 `lina-memory` |

后续候选（待定，需先确认许可证与必要性）：插件市场、多代理团队引擎、工程方法类技能（以 DSH 原生 `SKILL.md` 形态纳入，非插件层）。

## 目录约定

```text
work-personal-secretary/
├── modules/<子项目>/          # 每个子项目是一个可独立测试/打包的单元
│   └── dsh-lina-memory/       #   记忆插件（含自己的 package.json / README / CHANGELOG / 回归）
├── .github/workflows/ci.yml   # 仓库级 CI：遍历所有子项目跑回归
└── README.md
```

## 开发与验证

```bash
# 跑某个子项目的回归
node modules/dsh-lina-memory/scripts/regression.mjs

# 语法自检
node --check modules/dsh-lina-memory/lib/index.js
```

- 每个子项目**零运行时依赖**（只用 node 内置模块），回归脚本可直接执行，CI 不需要 `npm install`。
- 改客户端代码（`client/`）必须同步升该子项目的 `package.json` 版本：DSH 的客户端 bundle 按 revision 缓存，不升版本渲染进程不会重新拉取。
- 装到 DSH profile 的方式见各子项目 README（`dsh plugin add` + `dsh.profile.bundles`）。

## 许可

MIT（见各子项目 `LICENSE`）。
