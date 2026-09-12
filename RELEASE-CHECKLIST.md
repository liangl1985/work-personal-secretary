# 发布检查清单（work-personal-secretary）

> 每次发布/交付前逐项打勾；任何一项不满足就不发。宿主基线：**DSH Desktop 2.0.9 / host `dsh 0.1.5-rc.1`**（升 DSH 后先重跑本清单）。

## 一、默认约定必须随包生效（2026-09-11 定）

- [ ] **语言**：默认「**尽量**使用简体中文回答与思维」（推理痕迹也尽量用简体中文；代码/命令/路径/包名/API/日志原文/专有名词保留英文，不硬翻）
  - [ ] `defaults/global-memory.seed.md`（**全局记忆种子**）存在，含语言偏好条目
  - [ ] `defaults/AGENTS.zh-CN.md`（**工作区指令模板**）存在，含《语言》段
  - [ ] 根 README「默认约定」段写明该默认，并指向 `defaults/`
- [ ] **运行架构**：总控兼读制写进默认约定（主对话轻量：拆解/派单/核对/监督/纠正/对外沟通；重活交专家子代理）
- [ ] **敏感行业例外**：军工/商密/烟草/数据安全类内容由主上下文直接处理、不派子代理（红线，随包默认）

## 二、中立与隐私（发布件不得夹带私人信息/身份）

- [ ] **不得出现任何个人化身份**：私有助手名（如本机自用名）、"主人/主人级"等私有称呼、个人邮箱/账号
  - 检索方式：`git grep -n -i -e '<私有名>' -e '主人'`，命中项须为通用表述（使用者/助手）
- [ ] **不得出现私有路径**：`E:\...`、`~/.dsh/memories/<私有名>`、个人 Obsidian 目录等；默认路径必须通用（如 `~/.dsh/memories/work-memory`）
- [ ] `cordis.patch.yml` 及各模块默认配置**中性**：无个人路径、无称呼
- [ ] 个性化只走**设置页用户层**（不写进包内默认层）
- [ ] 包内**不含任何记忆数据**（首装记忆为空，人设由首轮对话填充）
- [ ] README 写清：本地 / 明文 / 不联网 / 无遥测；安装、首次使用、卸载与数据留存三段齐全

## 三、工程门禁

- [ ] 全部 JS `node --check` 通过
- [ ] 全部 Python 脚本 `py -3 -m py_compile` 通过（`modules/dsh-doc-suite/`）
- [ ] 各子项目回归全绿（`node modules/<模块>/scripts/regression.mjs`）
- [ ] CI 在 Node 22 与 24 双版本通过
- [ ] 客户端有改动的模块**已升版本号**（DSH 客户端 bundle 按 revision 缓存）
- [ ] 打包白名单（`files`）覆盖 lib / client / scripts / skills / cordis.patch.yml / CHANGELOG / LICENSE / README
- [ ] `CHANGELOG.md` 记录本次变更（含破坏性变更与迁移说明）

## 三点五、文档模块硬前置与路径（2026-09-13 增）

- [ ] README 明写 `dsh-doc-suite` 的两条**硬前置**：**Python ≥ 3.10**（建议 3.12，Windows 用 `py -3`）+ **WPS Office**（COM 通道）
- [ ] 明确声明**不自动安装**解释器与 WPS；缺什么由 `doctor.py` 检测并打印可复制的修复命令
- [ ] `modules/dsh-doc-suite/skills/*/SKILL.md` 中**不得出现作者机器绝对路径**（形如 `<盘符>:\<个人工作区>\scripts\...`）；
      统一使用占位符 `<DOC_SUITE_SCRIPTS>`，解析方式写进技能与 README（`doctor.py --emit-skill-paths`）
- [ ] 技能含**子命令速查表**（位置参数 vs 选项参数易错点：`convert <src> <dst>` 无 `--to`、`merge/make` 输出在前等）
- [ ] `doctor.py` 在本机跑通且结论为「环境就绪」（`/doc-doctor` 同源）

## 四、宿主兼容性

- [ ] 仅使用当前 host 的**原生扩展点**（tools / commands / settings / resources / sidebarRightTabs / locale / skills），不用已弃用槽位
- [ ] `dsh --profile <profile> --dump-config` 退出码 0，且能看到各模块条目
- [ ] 装到干净 profile 后**重启**验证：面板可开、工具可用、日志无报错

## 五、第三方合规

- [ ] 内置的第三方代码/资源**许可证允许再分发**（无 LICENSE 的组件只能列为可选依赖，不得打包）
- [ ] 列为可选依赖的插件在 README 中标注来源与许可证
- [ ] 保留必要的来源归属与许可证文本
