/**
 * work-personal-secretary —— 集成体本体 · Web 客户端半（DSH 0.1.5-rc.1 原生架构）
 *
 * 注册方式：原生 "settings.section" 槽位 → 设置左侧出现独立分区「工作秘书」。
 * 为什么不用宿主「插件配置」页：那一页只列**宿主平面插件**（终端 / Agent 循环 /
 * Subagent / 网页搜索），用户插件要出现在其中需自行贡献 "settings.plugin.item"；
 * 本集成体选择独立分区，既不与宿主插件混淆，也好找。
 *
 * 写法沿用集成体现有模块的**手写 loader bundle**：不引入构建步骤，
 * 只依赖宿主注入的 react（"window.__ModuleLoader__" 模块表）。
 * 版本号与 package.json 同步维护（见 BUILD）。
 *
 * 「安装与检查」页（P1）：只读检测 + 受控补齐。
 * - GET  /work-personal-secretary/api/check   → 七项环境清单（只读）
 * - POST /work-personal-secretary/api/fix     → 单项补齐 body { id }
 * - POST /work-personal-secretary/api/fix-all → 批量补齐 body { ids: [...] }（串行）
 * 客户端只上报 id：命令与白名单全在宿主侧，不接受任何外部命令字符串。
 */
window.__ModuleLoader__.load({
  id: 'work-personal-secretary',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    /**
     * 部分渲染替身（冒烟测试 / 纯元素树）只提供 createElement 与 useState。
     * 没有 useEffect 时退化为空实现：页面照样渲染骨架，只是不自动发起检测。
     */
    const useEffect = typeof React.useEffect === 'function' ? React.useEffect : function noopEffect() {}

    const NS = 'work-personal-secretary'
    /** 构建/界面标记：与 package.json 的 version 同步 */
    const BUILD = 'v1.0.0'

    /** 宿主路由前缀（与宿主半 lib 注册的路径一致） */
    const API = '/work-personal-secretary/api'
    /**
     * 宿主路由的基址与载体分档。
     * - Web 载体：页面 origin 是真的 http origin，走**根相对路径**（同源，最自然）；
     * - 桌面外壳：用 file:// 加载 dist，"location.origin" 返回字符串 "null"，此时
     *   根相对路径必然失败（还会在控制台刷红字），所以**直接**走合成 origin
     *   "http://dsh.internal"（外壳的 fetch 桥会把它转发给宿主）——这是一方
     *   dsh-client-file-upload 的既有做法。每个请求只发一次，不产生失败噪音。
     */
    const HOST_ORIGIN = (() => {
      try {
        const origin = typeof window !== 'undefined' && window.location ? window.location.origin : undefined
        if (origin === undefined || origin === '' || origin === 'null') return ''
        return String(origin)
      } catch {
        return ''
      }
    })()
    const HOST_BASE = HOST_ORIGIN || 'http://dsh.internal'
    /** true = 桌面外壳（无可用 origin）：只走合成基址，不再尝试根相对路径 */
    const HOST_FALLBACK = HOST_ORIGIN === ''

    /** 环境清单七项：固定顺序即展示顺序（id 与宿主契约一致） */
    const ITEM_IDS = ['host', 'node', 'python', 'pythonDeps', 'wps', 'obsidian', 'subPlugins']
    /** 七项的中英名（接口的 label 只作未知 id 的兜底） */
    const ITEM_LABEL_KEYS = {
      host: 'itemHost',
      node: 'itemNode',
      python: 'itemPython',
      pythonDeps: 'itemPythonDeps',
      wps: 'itemWps',
      obsidian: 'itemObsidian',
      subPlugins: 'itemSubPlugins',
    }
    /** 可代执行项在「将安装」摘要里的说法 */
    const INSTALL_DESC_KEYS = {
      python: 'descPython',
      pythonDeps: 'descPythonDeps',
      wps: 'descWps',
      obsidian: 'descObsidian',
    }
    /**
     * 批量补齐的**固定执行顺序**（客户端写死）：只对选中项过滤，不改变相对顺序。
     * 逐个调用 POST /fix，每步完成立刻回显 —— 装 Python / WPS / Obsidian 可能
     * 耗时数分钟，逐项进度比整批转圈对新手友好。
     */
    const FIX_ORDER = ['python', 'pythonDeps', 'wps', 'obsidian']
    /**
     * 四步安装流程。当前步由页面用 props.current 指定：
     * 「安装与检查」页 = env，「安装子插件」页 = plugins；「初始化」固定标「后续版本」。
     */
    const STEPS = [
      ['env', 'stepEnv', ''],
      ['deps', 'stepDeps', ''],
      ['plugins', 'stepPlugins', ''],
      ['init', 'stepInit', 'later'],
    ]
    /** 状态 → 文案键（ok | warn | missing | skip） */
    const STATUS_KEYS = { ok: 'statusOk', warn: 'statusWarn', missing: 'statusMissing', skip: 'statusSkip' }
    /** 批量执行状态 → 文案键 / 徽标样式 */
    const RUN_STATE_KEYS = { wait: 'runWait', run: 'runRunning', ok: 'runOk', fail: 'runFail' }
    /** 转圈动画：内联样式表（无构建步骤；按钮里的 ⟳ 用 .wps-spin） */
    const KEYFRAMES = '@keyframes wpsSpin{to{transform:rotate(360deg)}}.wps-spin{display:inline-block;animation:wpsSpin .9s linear infinite}'

    /**
     * P2「安装子插件」：五项的**固定顺序**（客户端写死，与接口是否可达无关，
     * 保证加载中/出错时也能渲染骨架）。nameKey = 接口未给 name 时的中英文名兜底；
     * nature = 性质兜底（self=自研 / third=第三方）。
     */
    const INSTALL_ORDER = ['dsh-work-memory', 'dsh-doc-suite', 'dsh-experts', 'dsh-mermaid', 'dsh-token-pet']
    const PLUGIN_META = {
      'dsh-work-memory': { nameKey: 'plugMemory', nature: 'self' },
      'dsh-doc-suite': { nameKey: 'plugDocs', nature: 'self' },
      'dsh-experts': { nameKey: 'plugExperts', nature: 'self' },
      'dsh-mermaid': { nameKey: 'plugCharts', nature: 'third' },
      'dsh-token-pet': { nameKey: 'plugPet', nature: 'third' },
    }
    /** 子插件状态 → 文案键 / 徽标样式 */
    const PLUG_STATUS_KEYS = {
      upToDate: 'plugStatusUpToDate',
      installable: 'plugStatusInstallable',
      updatable: 'plugStatusUpdatable',
    }
    /** 安装方式 → 文案键（file / link 保留原样，copy 显示「复制」） */
    const MODE_KEYS = { file: 'modeFile', link: 'modeLink', copy: 'modeCopy' }
    /** 逐项安装状态 → 文案键（run 用「安装中」，与逐项进度同一口径） */
    const INSTALL_STATE_KEYS = { wait: 'runWait', run: 'installRunning', ok: 'runOk', fail: 'runFail' }

    const ZH = {
      nav: '工作秘书',
      title: '工作秘书',
      lead: '一个集成体统一五套能力。环境检查、依赖补齐与子插件安装已可用；初始化与能力配置在后续版本提供。',
      tabInstall: '安装与检查',
      tabConfig: '能力配置',
      tabAbout: '关于与致谢',
      aboutSect: '关于与致谢',
      integrator: '集成体本体',
      includes: '本集成体包含的插件（5 个）',
      colPlugin: '插件',
      colKind: '性质',
      colLicense: '许可',
      colPurpose: '用途',
      thanks: '第三方来源与致谢',
      colUpstream: '上游项目',
      colUsedFor: '用于',
      compliance: '合规与免责',
      complianceText:
        '专家库中安全域与法务类条目标注「未经专业复核」—— 只作专业参考视角，不得据此出具测评结论、法律意见或对外结论，对外交付前须人工复核。本集成体本地运行、明文存储、不联网、无遥测。',
      noteFullList: '完整第三方清单与许可文本随包提供，见各模块 NOTICE 与 experts/index.json。',
      localOnly: '本地运行 · 明文存储 · 不联网 · 无遥测',
      devTitle: '该能力正在开发中',
      devConfig:
        '能力配置将把五个子插件的设置集中到这一个分区里读写：记忆库、专家库、文档能力、桌面形象各自分组。子插件的配置命名空间保持独立，单独安装时仍可各自配置。',
      back: '返回',

      // ── 安装与检查 ────────────────────────────────────────────────
      stepEnv: '环境检查',
      stepDeps: '补齐依赖',
      stepPlugins: '安装子插件',
      stepInit: '初始化',
      stepLater: '后续版本',
      stepNow: '当前',
      envTitle: '环境清单',
      checking: '检测中…',
      recheck: '重新检测',
      checkedAt: '检测时间',
      retry: '重试',
      loadFailed: '环境检测失败',
      loadFailedHint: '未能从本机服务取到数据：可能集成体尚未在宿主侧启用，或该路由还没注册。确认后点「重试」。',
      emptyList: '接口未返回环境项。',
      statusUnknown: '未知',
      statusOk: '正常',
      statusWarn: '警告',
      statusMissing: '缺失',
      statusSkip: '跳过',
      itemHost: 'DSH 宿主',
      itemNode: 'Node.js',
      itemPython: 'Python',
      itemPythonDeps: 'Python 依赖',
      itemWps: 'WPS Office',
      itemObsidian: 'Obsidian',
      itemSubPlugins: '子插件',
      conclusionStale: '检测到 {n} 项环境未就绪。',
      fixAllTop: '一键补齐全部（{n} 项）',
      fixSelected: '补齐选中项（{n}）',
      fixOne: '补齐',
      fixing: '补齐中…',
      fixingStep: '补齐中 {n}',
      batchHint: '逐项依次执行，完成一项立即回显',
      copyCommand: '复制命令',
      copied: '已复制',
      copyFailed: '复制失败，请手动选中命令复制',
      autoFixHint: '可由本集成体代执行',
      manualFixHint: '需手动安装，本页只给命令',
      willInstall: '将安装：',
      listSep: '、',
      descPython: 'Python 解释器（3.12）',
      descPythonDeps: 'Python 包（8 个）',
      descWps: 'WPS Office',
      descObsidian: 'Obsidian（可选组件）',
      pickHint: '勾选要补齐的项（可代执行的项默认已勾选）',
      wpsLicense: 'WPS Office 为第三方商业软件，安装即表示接受其许可协议。',
      reportTitle: '补齐结果',
      reportRunning: '执行中…',
      reportDone: '已完成',
      runWait: '等待',
      runRunning: '执行中',
      runOk: '成功',
      runFail: '失败',
      fixCommandLabel: '命令',
      fixExit: '退出码',
      fixDuration: '耗时',
      fixOutput: '输出（末尾 10 行）',
      fixOutputMore: '…（前文已省略）',
      fixFailed: '未能执行',
      footNote:
        '默认只读检测；只有你点补齐才会执行安装。命令来自内置白名单（Python 解释器 / Python 依赖 / WPS / Obsidian 四项），不接受外部输入。',

      // ── 安装子插件（P2） ──────────────────────────────────────────
      tabPlugins: '安装子插件',
      pluginsTitle: '子插件清单',
      pluginsLoading: '读取中…',
      pluginsLoadFailed: '子插件清单读取失败',
      pluginsLoadFailedHint:
        '未能从本机服务取到数据：可能集成体尚未在宿主侧启用，或该路由还没注册。确认后点「重试」。',
      pluginsEmpty: '接口未返回子插件清单。',
      repoRootLabel: '仓库目录',
      repoMissing: '未找到集成体仓库目录，请在设置里指定。',
      repoMissingTip: '未找到集成体仓库目录，安装已禁用：请先在设置里指定集成体仓库目录。',
      colBuiltin: '内置版本',
      colInstalled: '已装版本',
      colMode: '安装方式',
      notInstalled: '未安装',
      natureSelf: '自研',
      natureThird: '第三方',
      plugStatusUpToDate: '已是最新',
      plugStatusInstallable: '可安装',
      plugStatusUpdatable: '可更新',
      plugMemory: '记忆库',
      plugDocs: '文档能力',
      plugExperts: '专家库',
      plugCharts: '思维链与图表',
      plugPet: '桌面形象',
      modeFile: 'file',
      modeLink: 'link',
      modeCopy: '复制',
      installOne: '安装',
      installing: '安装中…',
      installRunning: '安装中',
      installingStep: '安装中 {n}',
      installSelected: '安装选中项（{n}）',
      installPickHint: '勾选要安装的子插件（可安装 / 可更新的项默认已勾选）',
      installBatchHint: '逐项依次安装，完成一项立即回显',
      installReportTitle: '安装结果',
      installReportRunning: '执行中…',
      installReportDone: '已完成',
      installFrom: '来源',
      installTo: '目标',
      installFiles: '文件',
      installVerified: '校验',
      installVerifiedOk: '通过',
      installVerifiedFail: '未通过',
      installDuration: '耗时',
      installFailed: '未能安装',
      installFilesCount: '{n} 个文件',
      installFootNote:
        '从集成体仓库内置副本安装（离线可用）；安装会更新当前 profile 的插件清单，需重启 DSH 生效。',
    }

    const EN = {
      nav: 'Work Secretary',
      title: 'Work Secretary',
      lead: 'One integrator for five capabilities. Environment check, dependency completion and sub-plugin installation are ready; initialization and capability config arrive in later versions.',
      tabInstall: 'Install & Check',
      tabConfig: 'Capabilities',
      tabAbout: 'About & Credits',
      aboutSect: 'About & Credits',
      integrator: 'Integrator',
      includes: 'Bundled plugins (5)',
      colPlugin: 'Plugin',
      colKind: 'Kind',
      colLicense: 'License',
      colPurpose: 'Purpose',
      thanks: 'Third-party sources & credits',
      colUpstream: 'Upstream project',
      colUsedFor: 'Used for',
      compliance: 'Compliance',
      complianceText:
        'Security and legal expert entries are marked as not professionally reviewed — they are reference perspectives only and must not be used to issue assessment conclusions or legal advice. Everything runs locally, in plain text, offline, without telemetry.',
      noteFullList: 'The full third-party list and license texts ship with the package (see each module NOTICE and experts/index.json).',
      localOnly: 'Local · plain text · offline · no telemetry',
      devTitle: 'In development',
      devConfig:
        'Capabilities will gather the five sub-plugins settings into this one section, grouped per module. Each sub-plugin keeps its own settings namespace so it still works standalone.',
      back: 'Back',

      // ── Install & Check ───────────────────────────────────────────
      stepEnv: 'Environment check',
      stepDeps: 'Complete dependencies',
      stepPlugins: 'Install sub-plugins',
      stepInit: 'Initialize',
      stepLater: 'Later version',
      stepNow: 'Current',
      envTitle: 'Environment list',
      checking: 'Checking…',
      recheck: 'Re-check',
      checkedAt: 'Checked at',
      retry: 'Retry',
      loadFailed: 'Environment check failed',
      loadFailedHint: 'No data from the local service: the integrator may be disabled on the host side, or the route is not registered yet. Confirm, then press Retry.',
      emptyList: 'The service returned no environment items.',
      statusUnknown: 'unknown',
      statusOk: 'ok',
      statusWarn: 'warn',
      statusMissing: 'missing',
      statusSkip: 'skip',
      itemHost: 'DSH host',
      itemNode: 'Node.js',
      itemPython: 'Python',
      itemPythonDeps: 'Python packages',
      itemWps: 'WPS Office',
      itemObsidian: 'Obsidian',
      itemSubPlugins: 'Sub-plugins',
      conclusionStale: '{n} environment item(s) need attention.',
      fixAllTop: 'Install everything ({n})',
      fixSelected: 'Install selected ({n})',
      fixOne: 'Install',
      fixing: 'Installing…',
      fixingStep: 'Installing {n}',
      batchHint: 'Runs one item at a time; each result appears as it finishes',
      copyCommand: 'Copy command',
      copied: 'Copied',
      copyFailed: 'Copy failed — select the command and copy it manually',
      autoFixHint: 'This integrator can run it',
      manualFixHint: 'Manual install; this page only shows the command',
      willInstall: 'Will install: ',
      listSep: ', ',
      descPython: 'Python interpreter (3.12)',
      descPythonDeps: 'Python packages (8)',
      descWps: 'WPS Office',
      descObsidian: 'Obsidian (optional)',
      pickHint: 'Tick the items to install (auto-fixable items are pre-selected).',
      wpsLicense: 'WPS Office is third-party commercial software; installing it means accepting its license agreement.',
      reportTitle: 'Install result',
      reportRunning: 'Running…',
      reportDone: 'Done',
      runWait: 'Waiting',
      runRunning: 'Running',
      runOk: 'Success',
      runFail: 'Failed',
      fixCommandLabel: 'Command',
      fixExit: 'Exit code',
      fixDuration: 'Duration',
      fixOutput: 'Output (last 10 lines)',
      fixOutputMore: '… (earlier output omitted)',
      fixFailed: 'Not executed',
      footNote:
        'Read-only by default: this page only inspects the machine. Nothing is installed until you press an install button, and every command comes from a built-in allow-list (Python interpreter / Python packages / WPS / Obsidian) — no external input is accepted.',

      // ── Install sub-plugins (P2) ──────────────────────────────────
      tabPlugins: 'Install sub-plugins',
      pluginsTitle: 'Sub-plugin list',
      pluginsLoading: 'Loading…',
      pluginsLoadFailed: 'Sub-plugin list failed to load',
      pluginsLoadFailedHint:
        'No data from the local service: the integrator may be disabled on the host side, or the route is not registered yet. Confirm, then press Retry.',
      pluginsEmpty: 'The service returned no sub-plugin list.',
      repoRootLabel: 'Repository',
      repoMissing: 'No integrator repository directory found — please specify it in settings.',
      repoMissingTip: 'Repository directory not set, so installation is disabled. Specify the integrator repository directory in settings first.',
      colBuiltin: 'Built-in version',
      colInstalled: 'Installed version',
      colMode: 'Install mode',
      notInstalled: 'Not installed',
      natureSelf: 'First-party',
      natureThird: 'Third-party',
      plugStatusUpToDate: 'Up to date',
      plugStatusInstallable: 'Installable',
      plugStatusUpdatable: 'Updatable',
      plugMemory: 'Memory',
      plugDocs: 'Documents',
      plugExperts: 'Experts',
      plugCharts: 'Charts',
      plugPet: 'Desktop pet',
      modeFile: 'file',
      modeLink: 'link',
      modeCopy: 'copy',
      installOne: 'Install',
      installing: 'Installing…',
      installRunning: 'Installing',
      installingStep: 'Installing {n}',
      installSelected: 'Install selected ({n})',
      installPickHint: 'Tick the sub-plugins to install (installable / updatable items are pre-selected).',
      installBatchHint: 'Runs one item at a time; each result appears as it finishes',
      installReportTitle: 'Install result',
      installReportRunning: 'Running…',
      installReportDone: 'Done',
      installFrom: 'From',
      installTo: 'To',
      installFiles: 'Files',
      installVerified: 'Verified',
      installVerifiedOk: 'passed',
      installVerifiedFail: 'not passed',
      installDuration: 'Duration',
      installFailed: 'Install failed',
      installFilesCount: '{n} file(s)',
      installFootNote:
        'Installs from the bundled copy inside the integrator repository (works offline); installation updates the current profile plugin list and requires a DSH restart to take effect.',
    }

    /** 包含的五个子插件（不写版本号：版本随使用者安装情况而变，由后续安装器探测） */
    const PLUGINS = [
      ['dsh-work-memory', '记忆库', '自研', 'MIT', '执行层长期记忆：三级记忆模型 + 转冷预审 + 侧边栏记忆面板'],
      ['dsh-doc-suite', '文档能力', '自研', 'MIT', 'Word / Excel / PPT / PDF 四格式处理与只读精确提取（需 Python 与 WPS）'],
      ['dsh-experts', '专家库', '自研', 'MIT', '按岗位关联的专家 persona：常驻一位身份专家，其余按问题归属补位或派子代理'],
      ['dsh-mermaid', '思维链与图表', '第三方', 'MIT', '把 Mermaid 代码块渲染成流程图 / 时序图，可切换图与代码'],
      ['dsh-token-pet', '桌面形象', '第三方定制层', 'MIT', '桌面宠物外观与动作（以上游为基线、以补丁维护）'],
    ]

    /** 第三方来源与致谢（主要上游；完整清单见各模块 NOTICE） */
    const THANKS = [
      ['jnMetaCode/agency-agents-zh', 'MIT', '售前类 persona 来源'],
      ['VoltAgent/awesome-claude-code-subagents', 'MIT', '售前 / 售后 / 销售工程师 persona'],
      ['Masriyan/Claude-Code-CyberSecurity-Skill', 'MIT', '网络安全 / 工控安全 persona'],
      ['daemon-blockint-tech/Agentic-Enteprises-Skill', 'MIT', 'SCADA 与工控安全运维 persona'],
      ['openocta/openocta_skills', 'MIT', '等保测评（GB/T 22239-2019 口径）'],
      ['kylin985ti/china-accounting-skills', 'MIT', '会计 / 税务 / 出纳 / 财务分析'],
      ['kingselyjoe/dsh-legal-work-bench', 'Apache-2.0', '民法 / 刑法咨询'],
      ['mizzlelover/gongwen-gbt9704-skill', 'MIT', '公文与报告排版'],
      ['ningzimu/codex-ppt-skill', 'MIT', 'PPT 制作'],
      ['MrmoLabs/dsh-mermaid', 'MIT', '思维链与图表渲染'],
      ['DSH Token Pet contributors', 'MIT', '桌面形象上游'],
    ]

    const S = {
      wrap: { padding: '2px 0 28px', color: '#1f2328', lineHeight: 1.55 },
      h1: { fontSize: '21px', fontWeight: 700, margin: '0 0 6px', letterSpacing: '.2px' },
      lead: { color: '#6b7280', fontSize: '13px', margin: '0 0 14px' },
      bar: {
        display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
        background: '#f7f8f9', border: '1px solid #e9eaed', borderRadius: '12px',
        padding: '10px 12px', marginBottom: '16px',
      },
      badge: {
        display: 'inline-block', padding: '1px 7px', borderRadius: '6px',
        background: '#eef0f2', color: '#4b5563', fontSize: '11.5px', fontWeight: 500,
      },
      badgeBrand: { background: '#e8eefc', color: '#2b4c9b' },
      badgeOk: { background: '#e7f7ee', color: '#16794a' },
      badgeWarn: { background: '#fff4e5', color: '#a15c00' },
      badgeMissing: { background: '#fdecec', color: '#b42318' },
      badgeSkip: { background: '#eef0f2', color: '#6b7280' },
      tabs: { display: 'flex', gap: '2px', borderBottom: '1px solid #eceef1', marginBottom: '16px' },
      tab: (on) => ({
        appearance: 'none', border: 0, background: 'transparent', cursor: 'pointer',
        padding: '8px 12px', fontSize: '13.5px', fontFamily: 'inherit',
        color: on ? '#111827' : '#6b7280', fontWeight: on ? 650 : 400,
        borderBottom: on ? '2px solid #111827' : '2px solid transparent', marginBottom: '-1px',
      }),
      card: {
        border: '1px solid #e6e7ea', borderRadius: '12px', background: '#fff',
        marginBottom: '12px', boxShadow: '0 1px 2px rgba(16,24,40,.03)',
      },
      cardHead: { padding: '14px 16px 10px' },
      cardTitle: { fontSize: '15px', fontWeight: 650, margin: 0, display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      cardSub: { color: '#8a8f98', fontSize: '12.5px', margin: '4px 0 0' },
      cardBody: { padding: '0 16px 14px' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', marginTop: '4px' },
      th: { textAlign: 'left', color: '#8a8f98', fontWeight: 600, fontSize: '11.5px', padding: '6px 8px', borderBottom: '1px solid #eceef1' },
      td: { padding: '7px 8px', borderBottom: '1px solid #f6f7f9', verticalAlign: 'top' },
      tdStrong: { padding: '7px 8px', borderBottom: '1px solid #f6f7f9', verticalAlign: 'top', fontWeight: 550, whiteSpace: 'nowrap' },
      note: {
        background: '#fbfbfc', border: '1px solid #eef0f2', borderRadius: '9px',
        padding: '10px 12px', fontSize: '12.5px', color: '#5b6068', marginTop: '10px',
      },
      mono: { fontFamily: 'Consolas, "Courier New", monospace', fontSize: '11.5px', background: '#f4f5f7', borderRadius: '4px', padding: '0 4px' },
      placeholder: { border: '1px dashed #dfe1e5', borderRadius: '12px', padding: '22px 18px', background: '#fcfcfd', color: '#5b6068', fontSize: '13px' },

      // ── 安装与检查（新增键） ──────────────────────────────────────
      steps: { display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' },
      step: {
        flex: '1 1 150px', minWidth: '132px', display: 'flex', gap: '9px', alignItems: 'flex-start',
        border: '1px solid #eef0f2', background: '#fbfbfc', borderRadius: '10px', padding: '9px 11px',
      },
      stepOn: { borderColor: '#c7d2fe', background: '#f3f6ff' },
      stepLater: { opacity: 0.72 },
      stepNo: {
        flex: '0 0 auto', width: '20px', height: '20px', borderRadius: '50%', background: '#e8eaf0',
        color: '#4b5563', fontSize: '11.5px', fontWeight: 650, display: 'flex', alignItems: 'center', justifyContent: 'center',
      },
      stepNoOn: { background: '#1d4ed8', color: '#fff' },
      stepName: { fontSize: '13px', fontWeight: 600, color: '#1f2328' },
      stepNameOn: { color: '#1d4ed8' },
      stepState: { fontSize: '11.5px', color: '#8a8f98', marginTop: '1px', minHeight: '14px' },
      conclusion: {
        display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
        background: '#fff9ef', border: '1px solid #f6e3c4', borderRadius: '12px', padding: '10px 12px', marginBottom: '12px',
      },
      conclusionText: { fontSize: '13px', color: '#8a5300', fontWeight: 550 },
      conclusionActions: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
      toolbar: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' },
      row: { padding: '10px 0', borderBottom: '1px solid #f6f7f9' },
      rowHead: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      check: { width: '14px', height: '14px', margin: 0, cursor: 'pointer', accentColor: '#1d4ed8', flex: '0 0 auto' },
      itemName: { fontSize: '13px', fontWeight: 600, minWidth: '96px' },
      itemValue: { fontFamily: 'Consolas, "Courier New", monospace', fontSize: '11.5px', color: '#4b5563', wordBreak: 'break-all' },
      itemDetail: { fontSize: '12.5px', color: '#6b7280', marginTop: '4px' },
      link: { color: '#1d4ed8', textDecoration: 'underline', wordBreak: 'break-all' },
      warnLine: {
        fontSize: '12px', color: '#8a5300', background: '#fff9ef', border: '1px solid #f6e3c4',
        borderRadius: '8px', padding: '6px 8px', marginTop: '6px',
      },
      cmdLine: { marginTop: '6px' },
      fixCmd: {
        display: 'block', fontFamily: 'Consolas, "Courier New", monospace', fontSize: '11.5px',
        background: '#f4f5f7', border: '1px solid #eceef1', borderRadius: '6px', padding: '6px 8px',
        color: '#334155', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      },
      actions: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '7px' },
      actionHint: { fontSize: '11.5px', color: '#8a8f98' },
      actionBar: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', margin: '2px 0 4px' },
      actionNote: { fontSize: '12px', color: '#8a8f98' },
      btn: {
        appearance: 'none', border: '1px solid #dfe1e5', background: '#fff', borderRadius: '8px',
        padding: '5px 11px', fontSize: '12.5px', fontFamily: 'inherit', cursor: 'pointer',
        color: '#1f2328', lineHeight: 1.4,
      },
      btnPrimary: { background: '#1f2328', borderColor: '#1f2328', color: '#fff', fontWeight: 600 },
      btnOk: { borderColor: '#16794a', color: '#16794a' },
      btnDisabled: { opacity: 0.55, cursor: 'default' },
      spinner: { marginRight: '5px' },
      error: { border: '1px solid #f3c9c9', background: '#fdf5f5', borderRadius: '10px', padding: '12px 14px', marginBottom: '10px' },
      errorTitle: { fontSize: '13.5px', fontWeight: 650, color: '#b42318' },
      errorMsg: { fontFamily: 'Consolas, "Courier New", monospace', fontSize: '11.5px', color: '#7a271a', margin: '5px 0', wordBreak: 'break-all' },
      errorHint: { fontSize: '12.5px', color: '#6b7280', marginBottom: '9px' },
      kv: { margin: '6px 0 0' },
      kvRow: { display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '4px' },
      kvKey: { flex: '0 0 84px', color: '#8a8f98', fontSize: '12px' },
      kvVal: { fontSize: '12.5px', color: '#1f2328' },
      outLabel: { fontSize: '11.5px', color: '#8a8f98', margin: '8px 0 4px' },
      out: {
        fontFamily: 'Consolas, "Courier New", monospace', fontSize: '11.5px', background: '#f7f8f9',
        border: '1px solid #eef0f2', borderRadius: '8px', padding: '8px 10px', color: '#334155',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '180px', overflow: 'auto',
      },
      runEntry: { padding: '9px 0', borderBottom: '1px solid #f6f7f9' },
      runHead: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
    }

    function badge(text, extra) {
      return h('span', { style: Object.assign({}, S.badge, extra || {}) }, text)
    }

    function statusLabel(t, status) {
      const key = STATUS_KEYS[status]
      return key ? t(key) : t('statusUnknown')
    }

    function statusStyle(status) {
      if (status === 'ok') return S.badgeOk
      if (status === 'warn') return S.badgeWarn
      if (status === 'missing') return S.badgeMissing
      return S.badgeSkip
    }

    function runStateStyle(state) {
      if (state === 'ok') return S.badgeOk
      if (state === 'run') return S.badgeWarn
      if (state === 'fail') return S.badgeMissing
      return S.badgeSkip
    }

    /** 把 {n} 替换成数量（中英语序不同，所以占位而不是拼接） */
    function fill(text, n) {
      return String(text).replace('{n}', String(n))
    }

    /** 毫秒 → 可读耗时（同时保留原始毫秒数，便于对照日志） */
    function formatDuration(ms) {
      const n = Number(ms)
      if (!isFinite(n) || n < 0) return String(ms === undefined || ms === null ? '—' : ms)
      if (n < 1000) return String(Math.round(n)) + ' ms'
      const sec = n < 10000 ? (n / 1000).toFixed(1) : String(Math.round(n / 1000))
      return sec + ' s (' + String(Math.round(n)) + ' ms)'
    }

    /** 只保留末尾 max 行（接口 output 已由宿主截断到 8000 字符） */
    function tailLines(text, max) {
      const lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/)
      const overflow = lines.length > max
      return { text: lines.slice(overflow ? lines.length - max : 0).join('\n'), overflow: overflow }
    }

    /** detail 里的 http(s) 链接渲染成可点击链接，其余文本原样保留 */
    function renderDetail(text) {
      const parts = String(text === undefined || text === null ? '' : text).split(/(https?:\/\/[^\s，。；、（）()]+)/g)
      return parts.map((p, i) => (/^https?:\/\//.test(p)
        ? h('a', { key: 'u' + i, href: p, target: '_blank', rel: 'noreferrer noopener', style: S.link }, p)
        : p))
    }

    /** 归一化单项补齐结果（/fix 与 /fix-all 的元素同构） */
    function normalizeFix(body, id, fallbackMsg) {
      const b = body || {}
      return {
        id: typeof b.id === 'string' ? b.id : id,
        ok: b.ok !== false,
        command: typeof b.command === 'string' ? b.command : '',
        exitCode: b.exitCode === undefined ? null : b.exitCode,
        durationMs: b.durationMs === undefined ? null : b.durationMs,
        output: typeof b.output === 'string' ? b.output : '',
        message: b.ok === false ? String(b.error || b.message || fallbackMsg) : '',
      }
    }

    /** /fix-all 的响应可能是数组，也可能包在 results / items / entries 里 */
    function fixAllList(body) {
      if (Array.isArray(body)) return body
      if (body && typeof body === 'object') {
        if (Array.isArray(body.results)) return body.results
        if (Array.isArray(body.items)) return body.items
        if (Array.isArray(body.entries)) return body.entries
      }
      return null
    }

    // ── P2「安装子插件」：/plugins 与 /install 响应归一化（字段一律容错） ──

    /** 取第一个「非空」候选（null / undefined / false / 空串都算缺失） */
    function firstText(...candidates) {
      for (const v of candidates) {
        if (typeof v === 'string' && v.trim() !== '') return v.trim()
        if (typeof v === 'number' && isFinite(v)) return String(v)
      }
      return ''
    }

    /** 性质归一：self = 自研 / third = 第三方 / '' = 未知 */
    function natureKey(value) {
      const s = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
      if (s === '') return ''
      if (s.indexOf('自研') >= 0 || s.indexOf('self') >= 0 || s.indexOf('first') >= 0
        || s.indexOf('bundled') >= 0 || s.indexOf('builtin') >= 0) return 'self'
      return 'third'
    }

    /** 安装方式归一：file / link / copy */
    function modeKey(value) {
      const s = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
      if (s === '') return ''
      if (s.indexOf('link') >= 0 || s.indexOf('链接') >= 0 || s.indexOf('符号') >= 0) return 'link'
      if (s.indexOf('copy') >= 0 || s.indexOf('复制') >= 0) return 'copy'
      if (s.indexOf('file') >= 0 || s.indexOf('文件') >= 0) return 'file'
      return ''
    }

    /**
     * 状态归一：upToDate / installable / updatable。
     * 接口给了 status 就认它（中英别名一并认）；没给就按「已装版本 vs 内置版本」推导。
     */
    function pluginStatus(raw, hasInstalled, installedVersion, builtin) {
      const s = String((raw && (raw.status || raw.state || raw.installState)) || '').trim().toLowerCase()
      let hit = ''
      if (s.indexOf('可更新') >= 0 || s.indexOf('updat') >= 0 || s.indexOf('outdated') >= 0) hit = 'updatable'
      else if (s.indexOf('已是最新') >= 0 || s.indexOf('最新') >= 0 || s.indexOf('up to date') >= 0
        || s.indexOf('latest') >= 0 || s.indexOf('uptodate') >= 0) hit = 'upToDate'
      else if (s.indexOf('可安装') >= 0 || s.indexOf('install') >= 0
        || s.indexOf('missing') >= 0 || s.indexOf('absent') >= 0) hit = 'installable'
      if (hit) return hit
      if (raw && raw.upToDate === true) return 'upToDate'
      if (!hasInstalled) return 'installable'
      if (builtin && installedVersion && installedVersion !== builtin) return 'updatable'
      return 'upToDate'
    }

    /** 归一化一项子插件；raw 为 null 表示接口没返回该项（只渲染骨架） */
    function normalizePlugin(raw, id, t) {
      const meta = PLUGIN_META[id] || {}
      const r = (raw && typeof raw === 'object') ? raw : null
      const fallback = meta.nameKey ? t(meta.nameKey) : ''
      const name = (r && firstText(r.name, r.title, r.label))
        || ((fallback && fallback !== meta.nameKey) ? fallback : id)
      const nature = natureKey(r && (r.nature || r.kind || r.source)) || meta.nature || ''
      const builtin = r ? firstText(r.builtinVersion, r.bundledVersion, r.repoVersion, r.version) : ''
      // 契约里 installed 是布尔、installedVersion 是版本（可 null）；两者取并集判断「装没装」，
      // 避免「已安装但版本读不到」被误判成可安装。
      const installedFlag = Boolean(r && (r.installed === true
        || (typeof r.installed === 'string' && r.installed.trim() !== '')))
      const installedVersion = r
        ? firstText(r.installedVersion, typeof r.installed === 'string' ? r.installed : '')
        : ''
      const hasInstalled = installedFlag || installedVersion !== ''
      const installed = installedVersion || (hasInstalled ? '—' : '')
      const mode = modeKey(r && (r.mode || r.installMode || r.installKind))
      const status = r ? pluginStatus(r, hasInstalled, installedVersion, builtin) : ''
      return {
        id: id, name: name, nature: nature, builtin: builtin, installed: installed,
        mode: mode, status: status,
        pickable: status === 'installable' || status === 'updatable',
      }
    }

    /** /plugins 的清单字段容错：plugins / items / list，或响应本身就是数组 */
    function pluginList(body) {
      if (Array.isArray(body)) return body
      if (body && typeof body === 'object') {
        if (Array.isArray(body.plugins)) return body.plugins
        if (Array.isArray(body.items)) return body.items
        if (Array.isArray(body.list)) return body.list
      }
      return []
    }

    /** 归一化单项安装结果（/install 与 /install-all 的元素同构） */
    function normalizeInstall(body, id, fallbackMsg) {
      const b = (body && typeof body === 'object') ? body : {}
      let files = b.files
      if (files === undefined) files = b.fileCount
      return {
        id: typeof b.id === 'string' ? b.id : id,
        ok: b.ok !== false,
        from: firstText(b.from, b.fromVersion),
        to: firstText(b.to, b.toVersion),
        files: files === undefined ? null : files,
        verified: b.verified === true ? true : (b.verified === false ? false : null),
        durationMs: b.durationMs === undefined ? null : b.durationMs,
        output: typeof b.output === 'string' ? b.output : '',
        message: b.ok === false ? String(b.error || b.message || fallbackMsg) : firstText(b.message),
      }
    }

    /** 安装失败的归一化结果（与 normalizeInstall 的面板同构） */
    function failedInstall(id, msg) {
      return {
        id: id, ok: false, from: '', to: '', files: null,
        verified: null, durationMs: null, output: '', message: String(msg),
      }
    }

    /** 安装文件数 / 文件列表 → 可读文本（列表只展示前 5 项） */
    function filesText(files, t) {
      if (typeof files === 'number' && isFinite(files)) return fill(t('installFilesCount'), Math.max(0, Math.round(files)))
      if (Array.isArray(files)) {
        if (files.length === 0) return fill(t('installFilesCount'), 0)
        const head = files.slice(0, 5).map((x) => String(x)).join(t('listSep'))
        return files.length > 5 ? head + ' …' : head
      }
      if (typeof files === 'string') return files
      return ''
    }

    function plugStatusLabel(t, status) {
      const key = PLUG_STATUS_KEYS[status]
      return key ? t(key) : t('statusUnknown')
    }

    function plugStatusStyle(status) {
      if (status === 'upToDate') return S.badgeOk
      if (status === 'updatable') return S.badgeWarn
      if (status === 'installable') return S.badgeBrand
      return S.badgeSkip
    }

    /**
     * 宿主请求（按载体分档，见 HOST_FALLBACK）：
     * - Web 载体：先按**市场同款**（根相对路径），失败再按**一方 file-upload 同款**
     *   （合成宿主 http://dsh.internal 的绝对 URL）；
     * - 桌面外壳：只用合成基址 —— 相对路径在这类载体下必然失败，先试一次只会拖慢
     *   并刷出控制台红字。
     * 全部尝试都失败就抛出合并原因，页面显示成可读错误 —— 绝不无声挂起。
     */
    async function requestJson(pathWithQuery, init, timeoutMs) {
      const rel = API + pathWithQuery
      const abs = new URL(rel, HOST_BASE).toString()
      // 桌面外壳只走合成基址；Web 载体先根相对路径、失败再合成基址
      const attempts = HOST_FALLBACK ? [abs] : [rel, abs]
      let lastErr = null
      for (const url of attempts) {
        let timer = null
        let ctl = null
        try {
          const opts = Object.assign({}, init || {})
          if (typeof AbortController === 'function') {
            ctl = new AbortController()
            opts.signal = ctl.signal
            if (timeoutMs) timer = setTimeout(() => { try { ctl.abort() } catch (e) { /* 忽略：仅用于取消 */ } }, timeoutMs)
          }
          const res = await fetch(url, opts)
          if (!res || res.ok === false) throw new Error('HTTP ' + String(res && res.status))
          return await res.json()
        } catch (err) {
          lastErr = String((err && err.message) || err) + ' @' + url
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
      throw new Error(lastErr || 'request failed')
    }

    function getJson(sub, timeoutMs) {
      return requestJson(sub, { headers: { accept: 'application/json' } }, timeoutMs)
    }

    /** 补齐用长超时：pip / winget 安装可能耗时数分钟，但也不能无限挂起 */
    function postJson(sub, body) {
      return requestJson(sub, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body || {}),
      }, 15 * 60 * 1000)
    }

    function StatusBar(props) {
      const t = props.t
      return h('div', { style: S.bar }, [
        h('span', { key: 'k', style: { fontSize: '12.5px', color: '#4b5563' } }, t('integrator')),
        h('span', { key: 'v', style: Object.assign({}, S.badge, S.badgeBrand) }, 'work-personal-secretary ' + BUILD),
      ].concat(PLUGINS.map((p) => h('span', { key: p[0], style: Object.assign({}, S.badge, S.badgeOk) }, p[1]))))
    }

    function Tabs(props) {
      const t = props.t
      const items = [
        ['install', t('tabInstall')],
        ['plugins', t('tabPlugins')],
        ['config', t('tabConfig')],
        ['about', t('tabAbout')],
      ]
      return h('div', { style: S.tabs }, items.map((it) =>
        h('button', {
          key: it[0], type: 'button', style: S.tab(props.tab === it[0]),
          onClick: () => props.setTab(it[0]),
        }, it[1])))
    }

    /** 四步进度条：current 指定当前步（默认 env），kind=later 的项标注「后续版本」 */
    function Steps(props) {
      const t = props.t
      const current = props.current || 'env'
      return h('div', { style: S.steps }, STEPS.map((s, i) => {
        const later = s[2] === 'later'
        const on = !later && s[0] === current
        return h('div', {
          key: s[0],
          style: Object.assign({}, S.step, on ? S.stepOn : null, later ? S.stepLater : null),
        }, [
          h('div', { key: 'n', style: Object.assign({}, S.stepNo, on ? S.stepNoOn : null) }, String(i + 1)),
          h('div', { key: 'b', style: { minWidth: 0 } }, [
            h('div', { key: 'nm', style: Object.assign({}, S.stepName, on ? S.stepNameOn : null) }, t(s[1])),
            h('div', { key: 'st', style: S.stepState }, later ? t('stepLater') : (on ? t('stepNow') : '')),
          ]),
        ])
      }))
    }

    /** 环境清单一行：复选框（可代执行项）· 中文名 · 状态徽标 · 证据值 · 说明 · 命令与操作 */
    function EnvRow(props) {
      const t = props.t
      const item = props.item
      const busy = Boolean(props.busy)
      const fixing = props.fixingId === item.id
      const hasCommand = item.fixKind !== 'none' && String(item.fixCommand || '').length > 0
      const showFix = item.autoFixable === true
      const showCopy = !showFix && hasCommand
      const copied = Boolean(props.copyState && props.copyState.id === item.id && props.copyState.ok)
      const copyBad = Boolean(props.copyState && props.copyState.id === item.id && !props.copyState.ok)
      const nodes = [
        h('div', { key: 'head', style: S.rowHead }, [
          showFix ? h('input', {
            key: 'pick', type: 'checkbox', checked: props.picked === true, disabled: busy,
            style: S.check, onChange: () => props.onToggle(item.id),
          }) : null,
          h('span', { key: 'nm', style: S.itemName }, item.name),
          h('span', { key: 'st', style: Object.assign({}, S.badge, statusStyle(item.status)) }, statusLabel(t, item.status)),
          h('span', { key: 'vl', style: S.itemValue }, String(item.value || '—')),
        ]),
      ]
      if (item.detail) nodes.push(h('div', { key: 'dt', style: S.itemDetail }, renderDetail(item.detail)))
      if (item.id === 'wps') nodes.push(h('div', { key: 'lic', style: S.warnLine }, t('wpsLicense')))
      if (hasCommand) nodes.push(h('div', { key: 'cmd', style: S.cmdLine }, h('code', { style: S.fixCmd }, item.fixCommand)))
      if (showFix || showCopy) {
        nodes.push(h('div', { key: 'act', style: S.actions }, [
          showFix ? h('button', {
            key: 'go', type: 'button',
            disabled: busy || fixing,
            style: Object.assign({}, S.btn, (busy || fixing) ? S.btnDisabled : null),
            onClick: () => props.onFix(item),
          }, fixing
            ? [h('span', { key: 'sp', className: 'wps-spin', style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }) }, '⟳'), t('fixing')]
            : t('fixOne')) : null,
          showCopy ? h('button', {
            key: 'cp', type: 'button', disabled: busy,
            style: Object.assign({}, S.btn, copied ? S.btnOk : null, busy ? S.btnDisabled : null),
            onClick: () => props.onCopy(item),
          }, copied ? t('copied') : t('copyCommand')) : null,
          h('span', { key: 'hint', style: S.actionHint },
            showFix ? t('autoFixHint') : (copyBad ? t('copyFailed') : t('manualFixHint'))),
        ]))
      }
      return h('div', { style: S.row }, nodes)
    }

    /** 批量/单项补齐报告里的一条：名称 · 状态 · 命令 · 退出码 · 耗时 · 输出尾部 */
    function FixEntry(props) {
      const t = props.t
      const e = props.entry
      const panel = e.panel
      const tail = panel ? tailLines(panel.output, 10) : { text: '', overflow: false }
      const nodes = [
        h('div', { key: 'head', style: S.runHead }, [
          h('span', { key: 'nm', style: S.itemName }, e.name),
          h('span', { key: 'st', style: Object.assign({}, S.badge, runStateStyle(e.state)) }, t(RUN_STATE_KEYS[e.state] || 'runWait')),
        ]),
      ]
      if (panel && panel.command) nodes.push(h('div', { key: 'cmd', style: S.cmdLine }, h('code', { style: S.fixCmd }, panel.command)))
      if (panel) {
        const kv = []
        if (panel.exitCode !== undefined && panel.exitCode !== null) kv.push(['exit', t('fixExit'), String(panel.exitCode)])
        if (panel.durationMs !== undefined && panel.durationMs !== null) kv.push(['time', t('fixDuration'), formatDuration(panel.durationMs)])
        if (kv.length) nodes.push(h('div', { key: 'kv', style: S.kv }, kv.map((r) => h('div', { key: r[0], style: S.kvRow }, [
          h('span', { key: 'k', style: S.kvKey }, r[1]),
          h('span', { key: 'v', style: S.kvVal }, r[2]),
        ]))))
        if (panel.message) nodes.push(h('div', { key: 'msg', style: S.note }, panel.message))
        if (tail.text) nodes.push(h('div', { key: 'out' }, [
          h('div', { key: 'l', style: S.outLabel }, t('fixOutput')),
          h('div', { key: 'x', style: S.out }, (tail.overflow ? t('fixOutputMore') + '\n' : '') + tail.text),
        ]))
      }
      return h('div', { style: S.runEntry }, nodes)
    }

    /** 补齐报告卡片（单项与批量共用） */
    function FixReport(props) {
      const t = props.t
      const batch = props.batch
      const entries = batch.order.map((id) => {
        const row = props.rows.filter((r) => r.id === id)[0] || { id: id, name: id }
        return { id: id, name: row.name, state: batch.state[id] || 'wait', panel: batch.results[id] || null }
      })
      return h('div', { style: S.card }, [
        h('div', { key: 'head', style: S.cardHead }, h('h3', { key: 't', style: S.cardTitle }, [
          t('reportTitle'),
          badge(batch.running ? t('reportRunning') : t('reportDone'), batch.running ? S.badgeWarn : S.badgeOk),
        ])),
        h('div', { key: 'body', style: S.cardBody }, entries.map((e) => h(FixEntry, { key: e.id, t: t, entry: e }))),
      ])
    }

    /**
     * 「安装与检查」页。
     * 生命周期：首次进入自动 GET /check（loading → ready / error）；
     * 单项「补齐」→ POST /fix { id }；底部主按钮 → POST /fix-all { ids }（串行），
     * 完成后自动重新检测。客户端从不发送命令字符串。
     */
    function InstallPage(props) {
      const t = props.t
      const state = useState({
        phase: 'loading', items: [], checkedAt: '', error: '',
        picked: {}, fixingId: '', batch: null, copyState: null,
      })
      const st = state[0]
      const setSt = state[1]

      async function detect() {
        setSt((prev) => Object.assign({}, prev, { phase: 'loading', error: '' }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const body = await getJson('/check', 15000)
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          if (body.ok === false) throw new Error(String(body.error || 'check 返回 ok:false'))
          setSt((prev) => Object.assign({}, prev, {
            phase: 'ready', error: '',
            items: Array.isArray(body.items) ? body.items : [],
            checkedAt: typeof body.checkedAt === 'string' ? body.checkedAt : '',
            picked: {}, // 重新检测后回到默认勾选（可代执行项）
          }))
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, { phase: 'error', error: String((err && err.message) || err) }))
        }
      }

      function setBatchState(id, value) {
        setSt((prev) => {
          const batch = prev.batch
          if (!batch) return prev
          const nextState = Object.assign({}, batch.state)
          nextState[id] = value
          return Object.assign({}, prev, { batch: Object.assign({}, batch, { state: nextState }) })
        })
      }

      /** 单项补齐：POST /fix { id } */
      async function runFix(item) {
        if (st.fixingId || (st.batch && st.batch.running)) return
        setSt((prev) => Object.assign({}, prev, {
          fixingId: item.id,
          batch: { running: true, order: [item.id], state: { [item.id]: 'run' }, results: {} },
        }))
        let panel = null
        try {
          const body = await postJson('/fix', { id: item.id })
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          panel = normalizeFix(body, item.id, t('fixFailed'))
        } catch (err) {
          panel = { id: item.id, ok: false, command: '', exitCode: null, durationMs: null, output: '', message: String((err && err.message) || err) }
        }
        setSt((prev) => Object.assign({}, prev, {
          fixingId: '',
          batch: { running: false, order: [item.id], state: { [item.id]: panel.ok ? 'ok' : 'fail' }, results: { [item.id]: panel } },
        }))
        await detect()
      }

      /**
       * 批量补齐（UI 主路径）：按客户端写死的顺序 python → pythonDeps → wps → obsidian
       * **逐个** POST /fix { id }（只对选中项过滤，不改变相对顺序）。每步完成立刻刷新
       * 该项状态与结果，这就是实时逐项进度。
       * 兜底：若逐个 /fix 在「请求层」失败、且本次任务尚无任何成功响应（典型情形是
       * 宿主半还没注册该路由），整体回退到 POST /fix-all { ids }。/fix-all 不再是主路径。
       */
      async function runBatch(ids) {
        if (!ids.length || st.fixingId || (st.batch && st.batch.running)) return
        // 固定顺序：先按 FIX_ORDER 过滤选中项，未知 id 保序追加（防御后续扩展）
        const order = FIX_ORDER.filter((id) => ids.indexOf(id) >= 0)
          .concat(ids.filter((id) => FIX_ORDER.indexOf(id) < 0))
        const initState = {}
        for (const id of order) initState[id] = 'wait'
        setSt((prev) => Object.assign({}, prev, {
          fixingId: '',
          batch: { running: true, order: order, state: initState, results: {} },
        }))
        const results = {}
        const states = {}
        let servedAny = false
        let fallback = false
        for (const id of order) {
          setBatchState(id, 'run')
          let panel = null
          let transportFailed = false
          try {
            const body = await postJson('/fix', { id: id })
            if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
            panel = normalizeFix(body, id, t('fixFailed'))
            servedAny = true
          } catch (err) {
            transportFailed = true
            panel = { id: id, ok: false, command: '', exitCode: null, durationMs: null, output: '', message: String((err && err.message) || err) }
          }
          results[id] = panel
          states[id] = panel.ok ? 'ok' : 'fail'
          setSt((prev) => {
            const batch = prev.batch || { order: order, state: {}, results: {} }
            return Object.assign({}, prev, {
              batch: Object.assign({}, batch, {
                state: Object.assign({}, batch.state, { [id]: states[id] }),
                results: Object.assign({}, batch.results, { [id]: results[id] }),
              }),
            })
          })
          if (transportFailed && !servedAny) { fallback = true; break }
        }
        if (fallback) {
          // 宿主未提供 /fix：整批交给 /fix-all，响应里的 results 逐项回填
          try {
            const body = await postJson('/fix-all', { ids: order })
            const list = fixAllList(body)
            if (!list) throw new Error('fix-all 响应不含逐项结果')
            list.forEach((x, i) => {
              const id = (x && typeof x.id === 'string') ? x.id : order[i]
              if (!id) return
              const panel = normalizeFix(x, id, t('fixFailed'))
              results[id] = panel
              states[id] = panel.ok ? 'ok' : 'fail'
            })
            if (!Object.keys(results).length) throw new Error('fix-all 响应为空')
          } catch (err) {
            const msg = String((err && err.message) || err)
            for (const id of order) {
              if (!states[id] || states[id] === 'wait') {
                results[id] = results[id] || { id: id, ok: false, command: '', exitCode: null, durationMs: null, output: '', message: msg }
                states[id] = 'fail'
              }
            }
          }
        }
        setSt((prev) => {
          const batch = prev.batch || { order: order, state: {}, results: {} }
          const nextState = Object.assign({}, batch.state)
          for (const id of order) if (states[id]) nextState[id] = states[id]
          return Object.assign({}, prev, {
            batch: { running: false, order: order, state: nextState, results: results },
          })
        })
        await detect()
      }

      async function copyCommand(item) {
        const text = String(item.fixCommand || '')
        let ok = false
        try {
          const nav = typeof navigator !== 'undefined' ? navigator : null
          if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
            await nav.clipboard.writeText(text)
            ok = true
          }
        } catch (err) {
          ok = false
        }
        setSt((prev) => Object.assign({}, prev, { copyState: { id: item.id, ok: ok } }))
      }

      function togglePick(id) {
        setSt((prev) => {
          const found = (prev.items || []).filter((x) => x && x.id === id)[0]
          const def = Boolean(found && found.autoFixable === true)
          const cur = prev.picked[id] !== undefined ? prev.picked[id] : def
          const next = Object.assign({}, prev.picked)
          next[id] = !cur
          return Object.assign({}, prev, { picked: next })
        })
      }

      useEffect(() => { detect() }, [])

      const byId = {}
      for (const it of (st.items || [])) { if (it && it.id) byId[it.id] = it }
      const rows = ITEM_IDS.map((id) => {
        const it = byId[id] || {}
        const labelKey = ITEM_LABEL_KEYS[id]
        const translated = labelKey ? t(labelKey) : ''
        return {
          id: id,
          name: (translated && translated !== labelKey) ? translated : (it.label || id),
          status: typeof it.status === 'string' ? it.status : '',
          value: typeof it.value === 'string' ? it.value : '',
          detail: typeof it.detail === 'string' ? it.detail : '',
          fixKind: typeof it.fixKind === 'string' ? it.fixKind : 'none',
          fixCommand: typeof it.fixCommand === 'string' ? it.fixCommand : '',
          autoFixable: it.autoFixable === true,
        }
      })
      const loading = st.phase === 'loading'
      const emptyList = st.phase === 'ready' && (!st.items || st.items.length === 0)
      const batchRunning = Boolean(st.batch && st.batch.running)
      const busy = batchRunning || st.fixingId !== ''
      const fixableIds = rows.filter((r) => r.autoFixable).map((r) => r.id)
      const pickedIds = fixableIds.filter((id) => (st.picked[id] !== undefined ? st.picked[id] : true))
      const pendingCount = rows.filter((r) => r.status === 'missing' || r.status === 'warn').length
      const needsWork = st.phase === 'ready' && pendingCount > 0 && fixableIds.length > 0
      const willInstall = t('willInstall') + pickedIds
        .filter((id) => INSTALL_DESC_KEYS[id])
        .map((id) => t(INSTALL_DESC_KEYS[id]))
        .join(t('listSep'))
      const batchOrder = st.batch ? st.batch.order : []
      const doneCount = st.batch
        ? batchOrder.filter((id) => st.batch.state[id] === 'ok' || st.batch.state[id] === 'fail').length
        : 0
      const progressText = fill(t('fixingStep'), Math.min(doneCount + 1, batchOrder.length || 1) + '/' + (batchOrder.length || 1))

      return h('div', null, [
        h('style', { key: 'kf' }, KEYFRAMES),
        h(Steps, { key: 'steps', t: t }),
        needsWork ? h('div', { key: 'concl', style: S.conclusion }, [
          h('span', { key: 'x', style: S.conclusionText }, fill(t('conclusionStale'), pendingCount)),
          h('div', { key: 'act', style: S.conclusionActions }, [
            h('span', { key: 'h', style: S.actionHint }, t('batchHint')),
            h('button', {
              key: 'b', type: 'button',
              disabled: busy,
              style: Object.assign({}, S.btn, S.btnPrimary, busy ? S.btnDisabled : null),
              onClick: () => runBatch(fixableIds),
            }, busy
              ? [h('span', { key: 'sp', className: 'wps-spin', style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }) }, '⟳'), progressText]
              : fill(t('fixAllTop'), fixableIds.length)),
          ]),
        ]) : null,
        h('div', { key: 'card', style: S.card }, [
          h('div', { key: 'head', style: S.cardHead }, [
            h('h3', { key: 'title', style: S.cardTitle }, [
              t('envTitle'),
              loading ? badge(t('checking'), S.badgeWarn) : null,
              st.checkedAt ? badge(t('checkedAt') + ' ' + st.checkedAt) : null,
            ]),
            h('div', { key: 'tools', style: S.toolbar }, [
              h('button', {
                key: 'recheck', type: 'button',
                disabled: loading,
                style: Object.assign({}, S.btn, loading ? S.btnDisabled : null),
                onClick: () => { setSt((prev) => Object.assign({}, prev, { batch: null, copyState: null })); detect() },
              }, loading
                ? [h('span', { key: 'sp', className: 'wps-spin', style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }) }, '⟳'), t('recheck')]
                : t('recheck')),
            ]),
          ]),
          h('div', { key: 'body', style: S.cardBody }, [
            st.phase === 'error' ? h('div', { key: 'err', style: S.error }, [
              h('div', { key: 't', style: S.errorTitle }, t('loadFailed')),
              h('div', { key: 'm', style: S.errorMsg }, st.error),
              h('div', { key: 'h', style: S.errorHint }, t('loadFailedHint')),
              h('button', {
                key: 'b', type: 'button',
                style: Object.assign({}, S.btn, S.btnPrimary),
                onClick: () => detect(),
              }, t('retry')),
            ]) : null,
            h('div', { key: 'list' }, rows.map((item) => h(EnvRow, {
              key: item.id, t: t, item: item,
              picked: st.picked[item.id] !== undefined ? st.picked[item.id] : item.autoFixable,
              fixingId: st.fixingId, copyState: st.copyState, busy: busy,
              onFix: runFix, onCopy: copyCommand, onToggle: togglePick,
            }))),
            emptyList ? h('div', { key: 'empty', style: S.note }, t('emptyList')) : null,
          ]),
        ]),
        h('div', { key: 'action', style: S.actionBar }, [
          h('button', {
            key: 'batch', type: 'button',
            disabled: busy || pickedIds.length === 0,
            style: Object.assign({}, S.btn, S.btnPrimary, (busy || pickedIds.length === 0) ? S.btnDisabled : null),
            onClick: () => runBatch(pickedIds),
          }, busy
            ? [h('span', { key: 'sp', className: 'wps-spin', style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }) }, '⟳'), progressText]
            : fill(t('fixSelected'), pickedIds.length)),
          h('span', { key: 'note', style: S.actionNote }, pickedIds.length ? (willInstall + ' · ' + t('batchHint')) : t('pickHint')),
        ]),
        st.batch ? h(FixReport, { key: 'fix', t: t, batch: st.batch, rows: rows }) : null,
        h('div', { key: 'foot', style: S.note }, t('footNote')),
      ])
    }

    /** 子插件清单一行：复选框 · 中文名 · 性质 · 状态 · 内置版本 · 已装版本 · 安装方式 · 单项安装 */
    function PluginRow(props) {
      const t = props.t
      const item = props.item
      const busy = Boolean(props.busy)
      const locked = props.canInstall !== true
      // 单项安装中（installingId）或批量轮到了这一项（running）→ 行内显示「安装中…」
      const installing = props.installingId === item.id || props.running === true
      const disabled = busy || locked || item.pickable !== true
      const natureText = item.nature === 'self'
        ? t('natureSelf')
        : (item.nature === 'third' ? t('natureThird') : t('statusUnknown'))
      const natureStyle = item.nature === 'self'
        ? S.badgeOk
        : (item.nature === 'third' ? S.badgeWarn : S.badgeSkip)
      const nodes = [
        h('div', { key: 'head', style: S.rowHead }, [
          h('input', {
            key: 'pick', type: 'checkbox',
            checked: props.picked === true,
            disabled: busy || locked,
            style: S.check,
            title: locked ? t('repoMissingTip') : undefined,
            onChange: () => props.onToggle(item.id),
          }),
          h('span', { key: 'nm', style: S.itemName }, item.name),
          h('span', { key: 'nat', style: Object.assign({}, S.badge, natureStyle) }, natureText),
          h('span', { key: 'st', style: Object.assign({}, S.badge, plugStatusStyle(item.status)) }, plugStatusLabel(t, item.status)),
        ]),
      ]
      nodes.push(h('div', { key: 'meta', style: S.itemDetail }, [
        t('colBuiltin') + ' ' + (item.builtin || '—'),
        ' · ' + t('colInstalled') + ' ' + (item.installed || t('notInstalled')),
        ' · ' + t('colMode') + ' ' + (MODE_KEYS[item.mode] ? t(MODE_KEYS[item.mode]) : (item.mode || '—')),
      ].join('')))
      nodes.push(h('div', { key: 'act', style: S.actions }, [
        h('button', {
          key: 'go', type: 'button',
          disabled: disabled,
          title: locked ? t('repoMissingTip') : undefined,
          style: Object.assign({}, S.btn, disabled ? S.btnDisabled : null),
          onClick: () => props.onInstall(item),
        }, installing
          ? [h('span', { key: 'sp', className: 'wps-spin', style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }) }, '⟳'), t('installing')]
          : t('installOne')),
      ]))
      return h('div', { style: S.row }, nodes)
    }

    /** 安装报告里的一条：名称 · 状态 · 来源 / 目标 / 文件 / 校验 / 耗时 */
    function InstallEntry(props) {
      const t = props.t
      const e = props.entry
      const panel = e.panel
      const nodes = [
        h('div', { key: 'head', style: S.runHead }, [
          h('span', { key: 'nm', style: S.itemName }, e.name),
          h('span', { key: 'st', style: Object.assign({}, S.badge, runStateStyle(e.state)) }, t(INSTALL_STATE_KEYS[e.state] || 'runWait')),
        ]),
      ]
      if (panel) {
        // 来源 / 目标 = 服务端拼接的绝对路径（长路径按 P1 的命令行样式换行）
        if (panel.from) {
          nodes.push(h('div', { key: 'from', style: S.cmdLine }, h('code', { style: S.fixCmd }, t('installFrom') + ' ' + panel.from)))
        }
        if (panel.to) {
          nodes.push(h('div', { key: 'to', style: S.cmdLine }, h('code', { style: S.fixCmd }, t('installTo') + ' ' + panel.to)))
        }
        const kv = []
        const ft = filesText(panel.files, t)
        if (ft) kv.push(['fs', t('installFiles'), ft])
        if (panel.verified !== null && panel.verified !== undefined) {
          kv.push(['vf', t('installVerified'), panel.verified ? t('installVerifiedOk') : t('installVerifiedFail')])
        }
        if (panel.durationMs !== undefined && panel.durationMs !== null) {
          kv.push(['tm', t('installDuration'), formatDuration(panel.durationMs)])
        }
        if (kv.length) {
          nodes.push(h('div', { key: 'kv', style: S.kv }, kv.map((r) => h('div', { key: r[0], style: S.kvRow }, [
            h('span', { key: 'k', style: S.kvKey }, r[1]),
            h('span', { key: 'v', style: S.kvVal }, r[2]),
          ]))))
        }
        if (panel.message) nodes.push(h('div', { key: 'msg', style: S.note }, panel.message))
        const tail = tailLines(panel.output, 10)
        if (tail.text) {
          nodes.push(h('div', { key: 'out' }, [
            h('div', { key: 'l', style: S.outLabel }, t('fixOutput')),
            h('div', { key: 'x', style: S.out }, (tail.overflow ? t('fixOutputMore') + '\n' : '') + tail.text),
          ]))
        }
      }
      return h('div', { style: S.runEntry }, nodes)
    }

    /** 安装报告卡片（单项与批量共用） */
    function InstallReport(props) {
      const t = props.t
      const batch = props.batch
      const entries = batch.order.map((id) => {
        const row = props.rows.filter((r) => r.id === id)[0] || { id: id, name: id }
        return { id: id, name: row.name, state: batch.state[id] || 'wait', panel: batch.results[id] || null }
      })
      return h('div', { style: S.card }, [
        h('div', { key: 'head', style: S.cardHead }, h('h3', { key: 't', style: S.cardTitle }, [
          t('installReportTitle'),
          badge(batch.running ? t('installReportRunning') : t('installReportDone'), batch.running ? S.badgeWarn : S.badgeOk),
        ])),
        h('div', { key: 'body', style: S.cardBody }, entries.map((e) => h(InstallEntry, { key: e.id, t: t, entry: e }))),
      ])
    }

    /**
     * 「安装子插件」页（P2）。
     * 生命周期：首次进入自动 GET /plugins（loading → ready / error）；
     * 单项「安装」→ POST /install { id }；底部主按钮 → 按固定顺序**逐个** POST /install { id }，
     * 每步完成立刻刷新该项状态（等待 / 安装中 / 成功 / 失败）与结果，完成后自动重新拉取 /plugins。
     * /install-all 仅作兜底（逐项请求层失败且本次尚无成功响应时回退）。
     */
    function PluginsPage(props) {
      const t = props.t
      const state = useState({
        phase: 'loading', items: [], repoRoot: '', hint: '', error: '',
        picked: {}, installingId: '', batch: null,
      })
      const st = state[0]
      const setSt = state[1]

      async function detect() {
        setSt((prev) => Object.assign({}, prev, { phase: 'loading', error: '' }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const body = await getJson('/plugins', 15000)
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          if (body.ok === false) throw new Error(String(body.error || 'plugins 返回 ok:false'))
          setSt((prev) => Object.assign({}, prev, {
            phase: 'ready', error: '',
            items: pluginList(body),
            repoRoot: typeof body.repoRoot === 'string' ? body.repoRoot.trim() : '',
            // 接口的 message（例如「未找到当前 profile 目录」）原样回显，不吞掉可读原因
            hint: typeof body.message === 'string' ? body.message.trim() : '',
            picked: {}, // 重新检测后回到默认勾选（可安装 / 可更新的项）
          }))
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, {
            phase: 'error', error: String((err && err.message) || err), items: [],
          }))
        }
      }

      function setBatchState(id, value) {
        setSt((prev) => {
          const batch = prev.batch
          if (!batch) return prev
          const nextState = Object.assign({}, batch.state)
          nextState[id] = value
          return Object.assign({}, prev, { batch: Object.assign({}, batch, { state: nextState }) })
        })
      }

      /** 单项安装：POST /install { id } */
      async function runInstall(item) {
        if (st.installingId || (st.batch && st.batch.running)) return
        setSt((prev) => Object.assign({}, prev, {
          installingId: item.id,
          batch: { running: true, order: [item.id], state: { [item.id]: 'run' }, results: {} },
        }))
        let panel = null
        try {
          const body = await postJson('/install', { id: item.id })
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          panel = normalizeInstall(body, item.id, t('installFailed'))
        } catch (err) {
          panel = failedInstall(item.id, String((err && err.message) || err))
        }
        setSt((prev) => Object.assign({}, prev, {
          installingId: '',
          batch: { running: false, order: [item.id], state: { [item.id]: panel.ok ? 'ok' : 'fail' }, results: { [item.id]: panel } },
        }))
        await detect()
      }

      /**
       * 批量安装（UI 主路径）：按客户端写死的五项目录顺序过滤选中项，**逐个**
       * POST /install { id }，每步完成立刻刷新该项状态与结果 —— 这就是实时逐项进度。
       * 兜底：若逐个 /install 在「请求层」失败、且本次任务尚无任何成功响应（典型情形是
       * 宿主半还没注册该路由），整体回退到 POST /install-all { ids }。/install-all 不是主路径。
       */
      async function runBatch(ids) {
        if (!ids.length || st.installingId || (st.batch && st.batch.running)) return
        // 固定顺序：先按 INSTALL_ORDER 过滤选中项，未知 id 保序追加（防御后续扩展）
        const order = INSTALL_ORDER.filter((id) => ids.indexOf(id) >= 0)
          .concat(ids.filter((id) => INSTALL_ORDER.indexOf(id) < 0))
        const initState = {}
        for (const id of order) initState[id] = 'wait'
        setSt((prev) => Object.assign({}, prev, {
          installingId: '',
          batch: { running: true, order: order, state: initState, results: {} },
        }))
        const results = {}
        const states = {}
        let servedAny = false
        let fallback = false
        for (const id of order) {
          setBatchState(id, 'run')
          let panel = null
          let transportFailed = false
          try {
            const body = await postJson('/install', { id: id })
            if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
            panel = normalizeInstall(body, id, t('installFailed'))
            servedAny = true
          } catch (err) {
            transportFailed = true
            panel = failedInstall(id, String((err && err.message) || err))
          }
          results[id] = panel
          states[id] = panel.ok ? 'ok' : 'fail'
          setSt((prev) => {
            const batch = prev.batch || { order: order, state: {}, results: {} }
            return Object.assign({}, prev, {
              batch: Object.assign({}, batch, {
                state: Object.assign({}, batch.state, { [id]: states[id] }),
                results: Object.assign({}, batch.results, { [id]: results[id] }),
              }),
            })
          })
          if (transportFailed && !servedAny) { fallback = true; break }
        }
        if (fallback) {
          // 宿主未提供 /install：整批交给 /install-all，响应里的 results 逐项回填
          try {
            const body = await postJson('/install-all', { ids: order })
            const list = fixAllList(body)
            if (!list) throw new Error('install-all 响应不含逐项结果')
            list.forEach((x, i) => {
              const id = (x && typeof x.id === 'string') ? x.id : order[i]
              if (!id) return
              const panel = normalizeInstall(x, id, t('installFailed'))
              results[id] = panel
              states[id] = panel.ok ? 'ok' : 'fail'
            })
            if (!Object.keys(results).length) throw new Error('install-all 响应为空')
          } catch (err) {
            const msg = String((err && err.message) || err)
            for (const id of order) {
              if (!states[id] || states[id] === 'wait') {
                results[id] = results[id] || failedInstall(id, msg)
                states[id] = 'fail'
              }
            }
          }
        }
        setSt((prev) => {
          const batch = prev.batch || { order: order, state: {}, results: {} }
          const nextState = Object.assign({}, batch.state)
          for (const id of order) if (states[id]) nextState[id] = states[id]
          return Object.assign({}, prev, {
            batch: { running: false, order: order, state: nextState, results: results },
          })
        })
        await detect()
      }

      function togglePick(id) {
        setSt((prev) => {
          const found = (Array.isArray(prev.items) ? prev.items : []).filter((x) => x && x.id === id)[0] || null
          const norm = normalizePlugin(found, id, t)
          const cur = prev.picked[id] !== undefined ? prev.picked[id] : norm.pickable
          const next = Object.assign({}, prev.picked)
          next[id] = !cur
          return Object.assign({}, prev, { picked: next })
        })
      }

      useEffect(() => { detect() }, [])

      const canInstall = st.phase === 'ready' && String(st.repoRoot || '').length > 0
      const byId = {}
      for (const raw of (Array.isArray(st.items) ? st.items : [])) { if (raw && raw.id) byId[raw.id] = raw }
      const rows = INSTALL_ORDER.map((id) => normalizePlugin(byId[id] || null, id, t))
      const loading = st.phase === 'loading'
      const batchRunning = Boolean(st.batch && st.batch.running)
      const busy = batchRunning || st.installingId !== ''
      const pickableIds = rows.filter((r) => r.pickable).map((r) => r.id)
      const pickedIds = pickableIds.filter((id) => (st.picked[id] !== undefined ? st.picked[id] : true))
      const installIds = canInstall ? pickedIds : []
      const emptyList = st.phase === 'ready' && (!st.items || st.items.length === 0)
      const repoBlocked = !loading && st.phase !== 'error' && !canInstall
      const batchOrder = st.batch ? st.batch.order : []
      const doneCount = st.batch
        ? batchOrder.filter((id) => st.batch.state[id] === 'ok' || st.batch.state[id] === 'fail').length
        : 0
      const progressText = fill(t('installingStep'), Math.min(doneCount + 1, batchOrder.length || 1) + '/' + (batchOrder.length || 1))

      return h('div', null, [
        h('style', { key: 'kf' }, KEYFRAMES),
        h(Steps, { key: 'steps', t: t, current: 'plugins' }),
        h('div', { key: 'card', style: S.card }, [
          h('div', { key: 'head', style: S.cardHead }, [
            h('h3', { key: 'title', style: S.cardTitle }, [
              t('pluginsTitle'),
              loading ? badge(t('pluginsLoading'), S.badgeWarn) : null,
              canInstall ? badge(t('repoRootLabel') + ' ' + st.repoRoot, S.badgeSkip) : null,
            ]),
            h('div', { key: 'tools', style: S.toolbar }, [
              h('button', {
                key: 'recheck', type: 'button',
                disabled: loading,
                style: Object.assign({}, S.btn, loading ? S.btnDisabled : null),
                onClick: () => { setSt((prev) => Object.assign({}, prev, { batch: null })); detect() },
              }, loading
                ? [h('span', { key: 'sp', className: 'wps-spin', style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }) }, '⟳'), t('recheck')]
                : t('recheck')),
            ]),
          ]),
          h('div', { key: 'body', style: S.cardBody }, [
            st.phase === 'error' ? h('div', { key: 'err', style: S.error }, [
              h('div', { key: 't', style: S.errorTitle }, t('pluginsLoadFailed')),
              h('div', { key: 'm', style: S.errorMsg }, st.error),
              h('div', { key: 'h', style: S.errorHint }, t('pluginsLoadFailedHint')),
              h('button', {
                key: 'b', type: 'button',
                style: Object.assign({}, S.btn, S.btnPrimary),
                onClick: () => detect(),
              }, t('retry')),
            ]) : null,
            repoBlocked ? h('div', { key: 'repo', style: S.warnLine }, t('repoMissing')) : null,
            // repoRoot 在、但接口另有提示（典型：profileDir 缺失）时原样显示
            (!repoBlocked && canInstall && st.hint) ? h('div', { key: 'hint', style: S.warnLine }, st.hint) : null,
            h('div', { key: 'list' }, rows.map((item) => h(PluginRow, {
              key: item.id, t: t, item: item,
              picked: st.picked[item.id] !== undefined ? st.picked[item.id] : item.pickable,
              installingId: st.installingId, busy: busy, canInstall: canInstall,
              running: batchRunning && Boolean(st.batch && st.batch.state[item.id] === 'run'),
              onInstall: runInstall, onToggle: togglePick,
            }))),
            emptyList ? h('div', { key: 'empty', style: S.note }, t('pluginsEmpty')) : null,
          ]),
        ]),
        h('div', { key: 'action', style: S.actionBar }, [
          h('button', {
            key: 'batch', type: 'button',
            disabled: busy || !canInstall || pickedIds.length === 0,
            title: canInstall ? undefined : t('repoMissingTip'),
            style: Object.assign({}, S.btn, S.btnPrimary, (busy || !canInstall || pickedIds.length === 0) ? S.btnDisabled : null),
            onClick: () => runBatch(installIds),
          }, busy
            ? [h('span', { key: 'sp', className: 'wps-spin', style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }) }, '⟳'), progressText]
            : fill(t('installSelected'), pickedIds.length)),
          h('span', { key: 'note', style: S.actionNote },
            !canInstall ? t('repoMissingTip') : (pickedIds.length ? t('installBatchHint') : t('installPickHint'))),
        ]),
        st.batch ? h(InstallReport, { key: 'rep', t: t, batch: st.batch, rows: rows }) : null,
        h('div', { key: 'foot', style: S.note }, t('installFootNote')),
      ])
    }

    function Placeholder(props) {
      const t = props.t
      return h('div', { style: S.placeholder }, [
        h('div', { key: 'h', style: { fontWeight: 650, color: '#1f2328', marginBottom: '6px' } }, t('devTitle')),
        h('div', { key: 'b' }, t('devConfig')),
      ])
    }

    function AboutPage(props) {
      const t = props.t
      return h('div', null, [
        h('div', { key: 'sum', style: S.card }, [
          h('div', { key: 'h', style: S.cardHead }, [
            h('h3', { key: 't', style: S.cardTitle }, [
              t('integrator'),
              badge('work-personal-secretary ' + BUILD, S.badgeBrand),
              badge('MIT'),
              badge(t('localOnly'), S.badgeOk),
            ]),
            h('p', { key: 's', style: S.cardSub }, t('includes')),
          ]),
          h('div', { key: 'b', style: S.cardBody },
            h('table', { style: S.table }, [
              h('thead', { key: 'h' }, h('tr', null, [
                h('th', { key: '1', style: S.th }, t('colPlugin')),
                h('th', { key: '2', style: S.th }, t('colKind')),
                h('th', { key: '3', style: S.th }, t('colLicense')),
                h('th', { key: '4', style: S.th }, t('colPurpose')),
              ])),
              h('tbody', { key: 'b' }, PLUGINS.map((p) => h('tr', { key: p[0] }, [
                h('td', { key: 'a', style: S.tdStrong }, h('code', { style: S.mono }, p[0])),
                h('td', { key: 'b', style: S.td }, p[2] === '自研' ? badge(p[2], S.badgeOk) : badge(p[2], S.badgeWarn)),
                h('td', { key: 'c', style: S.td }, p[3]),
                h('td', { key: 'd', style: S.td }, p[1] + '：' + p[4]),
              ]))),
            ])),
        ]),

        h('div', { key: 'thx', style: S.card }, [
          h('div', { key: 'h', style: S.cardHead }, h('h3', { key: 't', style: S.cardTitle }, t('thanks'))),
          h('div', { key: 'b', style: S.cardBody }, [
            h('table', { key: 'tb', style: S.table }, [
              h('thead', { key: 'h' }, h('tr', null, [
                h('th', { key: '1', style: S.th }, t('colUpstream')),
                h('th', { key: '2', style: S.th }, t('colLicense')),
                h('th', { key: '3', style: S.th }, t('colUsedFor')),
              ])),
              h('tbody', { key: 'b' }, THANKS.map((x) => h('tr', { key: x[0] }, [
                h('td', { key: 'a', style: S.td }, h('code', { style: S.mono }, x[0])),
                h('td', { key: 'b', style: S.td }, x[1]),
                h('td', { key: 'c', style: S.td }, x[2]),
              ]))),
            ]),
            h('div', { key: 'n', style: S.note }, t('noteFullList')),
          ]),
        ]),

        h('div', { key: 'cmp', style: S.card }, [
          h('div', { key: 'h', style: S.cardHead }, h('h3', { key: 't', style: S.cardTitle }, t('compliance'))),
          h('div', { key: 'b', style: S.cardBody }, h('div', { style: S.note }, t('complianceText'))),
        ]),
      ])
    }

    function Section(props) {
      const t = props.t
      // 默认仍是「关于与致谢」；initialTab 供冒烟测试与深链指定页签
      const first = ['install', 'plugins', 'config', 'about'].indexOf(props.initialTab) >= 0 ? props.initialTab : 'about'
      const state = useState(first)
      const tab = state[0]
      const setTab = state[1]
      let page = null
      if (tab === 'install') page = h(InstallPage, { key: 'i', t: t })
      else if (tab === 'plugins') page = h(PluginsPage, { key: 'g', t: t })
      else if (tab === 'config') page = h(Placeholder, { key: 'p', t: t })
      else page = h(AboutPage, { key: 'a', t: t })
      return h('div', { style: S.wrap }, [
        h('h1', { key: 'h', style: S.h1 }, t('title')),
        h('p', { key: 'l', style: S.lead }, t('lead')),
        h(StatusBar, { key: 'b', t: t }),
        h(Tabs, { key: 't', t: t, tab: tab, setTab: setTab }),
        page,
      ])
    }

    function apply(ctx) {
      // 文案：优先用宿主 locale 服务；缺它时回退内置中文（不影响分区注册）
      let t = (key) => (ZH[key] !== undefined ? ZH[key] : key)
      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'work-personal-secretary: dictionaries')
          const bound = ctx.locale.bind(NS)
          t = (key) => {
            try {
              const v = bound(key)
              return v === undefined || v === null || v === key ? (ZH[key] !== undefined ? ZH[key] : key) : v
            } catch {
              return ZH[key] !== undefined ? ZH[key] : key
            }
          }
        }
      } catch (err) {
        console.warn('work-personal-secretary client: locale 注册失败（回退内置中文）', err)
      }

      // render 透传宿主给的 props（当前只认 initialTab），保证默认页签不变
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'work-personal-secretary',
        order: 35,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t }),
      }, (props) => h(Section, { t: t, initialTab: props && props.initialTab })))
    }

    return { apply, inject: ['slots'] }
  },
})
