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
 *
 * 「初始化」页（P3：配置引导 / setup wizard）：
 * - GET  /work-personal-secretary/api/basedeck[?workspace=…] → 五项底座计划（只读预览）
 * - POST /work-personal-secretary/api/basedeck { ids, dryRun:false, overrides } → 逐项写入
 * - 首用必配项一次填完并写入；写前自动备份；完成后需重启 DSH 生效。
 *
 * 「能力配置」页（P4：读写子插件设置）：
 * - GET  /work-personal-secretary/api/settings         → 白名单裁剪的设置枚举（只读）
 * - POST /work-personal-secretary/api/settings/write   → { ns, dryRun:false, revision, ops }
 * - GET  /work-personal-secretary/api/experts/preview?text=… → 专家打分实时预览（只读）
 * 四组：记忆库（24 键）/ 专家库（阈值滑块 + 预览）/ 文档能力（自检状态）/ 桌面形象（状态 + 跳转）。
 * 409 冲突时提示并自动重读，草稿保留（不丢输入）；接口不可用时分组显示可读降级提示。
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
     * 「安装与检查」页 = env，「安装子插件」页 = plugins，「初始化」页 = init；
     * 未被当前页选中的后续步骤标注「后续版本」。
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
    const INSTALL_ORDER = ['dsh-work-memory', 'dsh-doc-suite', 'dsh-experts', 'dsh-mermaid', 'workspace-tokenpet']
    const PLUGIN_META = {
      'dsh-work-memory': { nameKey: 'plugMemory', nature: 'self' },
      'dsh-doc-suite': { nameKey: 'plugDocs', nature: 'self' },
      'dsh-experts': { nameKey: 'plugExperts', nature: 'self' },
      'dsh-mermaid': { nameKey: 'plugCharts', nature: 'third' },
      'workspace-tokenpet': { nameKey: 'plugPet', nature: 'third' },
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

    /**
     * P3「初始化」：五项**固定顺序**（客户端写死，与接口是否可达无关，
     * 保证加载中/出错时也能渲染骨架）。labelKey = 接口未给 label 时的中英文名兜底。
     */
    const INIT_ORDER = ['agentsMd', 'memorySeed', 'skills', 'settings', 'dirs']
    const INIT_LABEL_KEYS = {
      agentsMd: 'initItemAgentsMd',
      memorySeed: 'initItemMemorySeed',
      skills: 'initItemSkills',
      settings: 'initItemSettings',
      dirs: 'initItemDirs',
    }
    /** 计划状态 → 文案键（append | update | up_to_date | user_modified | ahead | broken | multiple | none） */
    const INIT_STATUS_KEYS = {
      append: 'initStatusAppend',
      update: 'initStatusUpdate',
      up_to_date: 'initStatusUpToDate',
      user_modified: 'initStatusUserModified',
      ahead: 'initStatusAhead',
      broken: 'initStatusBroken',
      multiple: 'initStatusMultiple',
      none: 'initStatusNone',
    }
    /** 预览最多展示的行数（原样展示，不折行不截断） */
    const INIT_PREVIEW_MAX = 20
    /** 「不使用镜像」的显式关闭哨兵（宿主端收到该值即写入空值 = 不镜像） */
    const OBSIDIAN_NO_MIRROR = '__none__'
    /** 逐项写入状态 → 文案键（写入语境：run = 写入中…） */
    const WRITE_STATE_KEYS = { wait: 'runWait', run: 'initWriting', ok: 'runOk', fail: 'runFail' }
    /** 写入执行顺序（客户端写死；展示顺序仍是 INIT_ORDER） */
    const WRITE_ORDER = ['dirs', 'memorySeed', 'skills', 'settings', 'agentsMd']
    /** 四段式向导：填写配置 → 检查与预览 → 执行 → 结果（阶段键与 stage 对应） */
    const WIZ_STEPS = [
      ['form', 'initStepForm'],
      ['preview', 'initStepPreview'],
      ['run', 'initStepRun'],
      ['done', 'initStepDone'],
    ]
    /** 工作岗位域下拉（值作为 overrides.defaultDomain 上报；文案随 locale 走） */
    const DOMAIN_OPTIONS = [
      ['presales', 'initDomainPresales'],
      ['aftersales', 'initDomainAftersales'],
      ['finance', 'initDomainFinance'],
      ['legal', 'initDomainLegal'],
      ['doc', 'initDomainDoc'],
      ['general', 'initDomainGeneral'],
    ]

    const ZH = {
      nav: '工作秘书',
      title: '工作秘书',
      lead: '一个集成体统一五套能力。环境检查、依赖补齐、子插件安装与配置引导已可用；能力配置在后续版本提供。',
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

      // ── 初始化 / 配置引导（P3） ────────────────────────────────────
      tabInit: '初始化',
      initTitle: '配置引导',
      initLead: '填好首用必配项，检查无误后一次性把配置底座写入。',
      initLoading: '检测中…',
      initLoadFailed: '初始化信息读取失败',
      initLoadFailedHint:
        '未能从本机服务取到数据：可能集成体尚未在宿主侧启用，或该路由还没注册。确认后点「重试」。',
      initEmpty: '接口未返回配置项。',
      initStepForm: '填写配置',
      initStepPreview: '检查与预览',
      initStepRun: '执行',
      initStepDone: '结果',
      initFormTitle: '首用必配项',
      initFormHint: '带 * 的为必填；其余留空即取默认值。',
      initOptional: '可选',
      initFieldWorkspace: '工作区目录',
      initFieldWorkspaceHint: '必填；AGENTS.md 与技能落盘到这里',
      initFieldDomain: '工作岗位域',
      initFieldDomainHint: '决定常驻的身份专家与默认视角',
      initFieldExpert: '身份专家',
      initFieldExpertHint: '留空 = 自动取岗位域第一位',
      initFieldMemoryDir: '记忆库目录',
      initFieldMemoryDirHint: '留空 = 默认',
      initFieldObsidianDir: 'Obsidian 库目录',
      initFieldObsidianDirHint: '留空将把记忆镜像到 <工作区>/work-memory（可在设置页随时改）',
      initDomainPresales: '售前',
      initDomainAftersales: '售后·技术支持',
      initDomainFinance: '会计财务',
      initDomainLegal: '法务',
      initDomainDoc: '文档',
      initDomainGeneral: '核查·通用',
      initDomainPlaceholder: '请选择…',
      initDomainRequired: '请先选择你的工作方向',
      initBrowse: '浏览…',
      initBrowseTip: '选择目录',
      initBrowseUnavailable: '当前载体不支持系统目录选择，请手动输入路径',
      initCandDetectedWorkspace: '使用探测到的工作区',
      initCandDefaultMemory: '使用默认（~/.dsh/memories/{n}）',
      initCandNoMirror: '不使用镜像',
      initCandNeedWorkspace: '需先填写工作区',
      initObsidianOffNote: '已选择不使用镜像',
      initCandMirrorAll: '<工作区>/00_全局记忆',
      initCandMirrorWork: '<工作区>/work-memory',
      initPickFailed: '目录选择失败：',
      initWsFromClient: '已由客户端指定工作区，请确认',
      initWsFromConfig: '已按设置里的工作区配置填入',
      initWsFromDerived: '已按记忆镜像目录反推，请确认',
      initWsFromCwd: '已按当前工作目录填入，请确认',
      initWsFromDefault: '已取默认工作区，请确认',
      initWsFromOther: '由本机服务提供，请确认',
      initWsRequired: '必须选择工作区',
      initCheckPreview: '检查并预览',
      initChecking: '检查中…',
      initRecheck: '重新检查',
      initPlanTitle: '写入计划',
      initPlanHint: '这是写入前的预览，尚未改动任何文件。',
      initBackToForm: '返回修改',
      initFinish: '完成配置',
      initFinishing: '写入中',
      initWriting: '写入中…',
      initRunProgress: '写入中 {done}/{total}',
      initWriteFailTitle: '写入失败',
      initWriteFailHint:
        '本机服务可能尚未支持写入（dryRun:false），或工作区不可写。可先用「检查并预览」确认计划，再重试。',
      initWriteDryRun: '本机服务仍按试运行处理（dryRun:true），未真正写入。',
      initWriteResult: '写入结果',
      initDoneTitle: '配置完成',
      initDonePartial: '部分失败',
      initDoneRestart: '配置已写入，需重启 DSH 生效。',
      initDoneHint: '重启后「工作秘书」即可开始使用；未成功的项可按上面的原因处理后再重跑。',
      initColTarget: '目标',
      initColBackup: '备份',
      initColBytes: '写入字节',
      initNoBackup: '无需备份',
      setupNeeded: '还差 {n} 项才能开始使用，点这里完成配置',
      setupGo: '去完成配置',
      workspaceLabel: '工作区',
      workspaceNoneHint: '未确定工作区路径，提交已禁用：请先填写工作区目录。',
      wsSourceConfig: '已配置',
      wsSourceDefault: '默认',
      wsSourceNone: '未确定',
      initStatusAppend: '将追加',
      initStatusUpdate: '将更新',
      initStatusUpToDate: '已是最新',
      initStatusUserModified: '被手工改过',
      initStatusAhead: '领先',
      initStatusBroken: '损坏',
      initStatusMultiple: '多份冲突',
      initStatusNone: '未检测到',
      initItemAgentsMd: '指令层 AGENTS.md',
      initItemMemorySeed: '记忆种子',
      initItemSkills: '技能',
      initItemSettings: '设置',
      initItemDirs: '目录结构',
      initPlanAction: '计划动作',
      initPreview: '预览',
      initPreviewHide: '收起预览',
      initPreviewEmpty: '（无可预览内容）',
      initPreviewMore: '…（仅显示前 {n} 行）',
      initBlockVersion: '标记块版本',
      initContentHash: '内容指纹',
      initSummary: '共 {total} 项 · 计划写入 {toWrite} 项 · 已是最新 {upToDate} 项 · 被阻塞 {blocked} 项',
      initSafety: '写入前会自动备份；AGENTS.md 只更新「工作秘书」标记块内的内容，你自己的段落不会被改动。',
      initListSep: '、',

      // ── 能力配置（P4：读写子插件设置） ─────────────────────────────
      // 页面：四组（记忆库 / 专家库 / 文档能力 / 桌面形象）。
      // 数据：GET /settings（白名单裁剪的只读枚举）；写入：POST /settings/write
      // （dryRun:false + revision 栅栏）；409 = 版本冲突 → 提示 + 自动重读。
      cfgLead:
        '四组能力：记忆库、专家库、文档能力、桌面形象。设置走本机服务（白名单命名空间 + 用户层），不会直接改写你手写的配置文件。',
      cfgReload: '重新读取',
      cfgLoading: '读取中…',
      cfgLastRead: '最近读取',
      cfgReloadFailed: '重新读取失败',
      cfgLoadFailed: '能力配置读取失败',
      cfgLoadFailedHint:
        '未能从本机服务取到设置：可能集成体尚未在宿主侧启用，或设置路由还没注册。可点「重试」；本页不会因此白屏。',
      cfgRetry: '重试',
      cfgConflict: '设置已被其他改动更新，已自动重新读取；你未保存的输入仍在。',
      cfgSaved: '已保存（免重启生效）。',
      cfgSaveFailed: '保存失败',
      cfgSaveDryRun: '本机服务仍按试运行处理（dryRun:true），未真正写入；改动仍留在草稿里。',
      cfgNoChange: '没有需要保存的改动。',
      cfgSkipped: '{n} 项因数值格式不正确被跳过。',
      cfgOverride: '已覆盖',
      cfgOverridePending: '待清除覆盖',
      cfgUnset: '清除覆盖',
      cfgRestore: '恢复默认',
      cfgSaveDraft: '保存改动（{n}）',
      cfgDirty: '{n} 项待保存',
      cfgWritableNo: '该命名空间当前不可写（只读）。',
      cfgNsUnavailable:
        '本机服务未提供该能力的设置命名空间 —— 子插件可能尚未安装或未启用。装好后这里会自动出现设置项。',
      cfgGroupOther: '其它设置项',
      cfgOn: '开',
      cfgOff: '关',
      cfgInjectMaxWarn: '注入 2–3 位会占用较多 TOKEN（每位 persona 约 3.3–4.9KB）。',
      cfgRevision: '版本 r{n}',
      cfgAppliedLive: '改动免重启生效',

      cfgGroupMemory: '记忆库',
      cfgMemoryLead: '执行层长期记忆（dsh-work-memory）。改动免重启生效；未覆盖的键取部署默认值。',
      cfgMemGInject: '注入与快照',
      cfgMemGInjectHint: '每轮注入记忆的总开关与快照容量',
      cfgMemGArchive: '冷热与归档',
      cfgMemGArchiveHint: '热记忆到期转冷（ARCHIVE）的期限；关键条目不转冷',
      cfgMemGTriage: '转冷预审',
      cfgMemGTriageHint: '到期不等于立即转冷：先结合近期日志与热记忆自动判断',
      cfgMemGOps: '备份与运维',
      cfgMemGOpsHint: '自动备份、告警提醒与自动记录行为',
      cfgMemGDirs: '目录',
      cfgMemGDirsHint: '记忆库根目录与 Obsidian 镜像目录；留空取默认',

      cfgGroupExperts: '专家库',
      cfgExpertsLead: '岗位专家库（dsh-experts）。常驻注入的只有一位身份专家，其余由「问题归属判断」决定是否补位。',
      cfgExpGCore: '专家与匹配范围',
      cfgExpGCoreHint: '身份专家、岗位域与参与自动匹配的范围',
      cfgExpGThreshold: '注入阈值与形态',
      cfgExpGThresholdHint: '决定每轮注入几位、注入多完整（精简卡还是全文）、字符预算与最低分',
      cfgExpPreview: '实时预览',
      cfgExpPreviewHint: '输入一段任务文本，按当前阈值试算注入名单与打分理由（只读，不产生写入）',
      cfgExpPreviewPlaceholder: '例如：这份合同的付款节点与税务怎么处理？',
      cfgExpPreviewGo: '试算',
      cfgExpPreviewRunning: '试算中…',
      cfgExpPreviewEmpty: '输入任务文本后点「试算」。',
      cfgExpPreviewReason: '判定理由',
      cfgExpPreviewSelected: '注入名单',
      cfgExpPreviewNone: '没有专家达到最低分：本轮按通用助手处理（宁缺勿滥）。',
      cfgExpPreviewConfig: '试算所用阈值',
      cfgExpPreviewColId: '专家',
      cfgExpPreviewColDomain: '域',
      cfgExpPreviewColScore: '分数',
      cfgExpPreviewColEvidence: '证据分',
      cfgExpPreviewColWhy: '理由',
      cfgExpPreviewUnavailable: '专家库未安装或未启用，打分预览暂不可用。',
      cfgExpPreviewFailed: '试算失败',
      cfgExpPreviewTruncated: '文本超过 2000 字符，已按前 2000 字符试算。',

      cfgGroupDocs: '文档能力',
      cfgDocLead: '文档能力（dsh-doc-suite）没有独立设置项，这里展示自检与依赖状态。',
      cfgDocDeps: '依赖状态',
      cfgDocDepsHint: '取自「安装与检查」页的环境探测结果（只读）',
      cfgDocSkills: '四技能落盘',
      cfgDocSkillHint: '技能落盘状态由文档模块的自检命令给出；本页只列清单，未接入该项结果不代表缺失。',
      cfgDocDoctor: '自检请在文档模块里运行 /doc-doctor；解释器与 WPS 不会被自动安装。',
      cfgDocCheckFailed: '未能取到依赖状态',
      cfgDocCheckHint: '本机服务未提供环境检查接口时，这里只显示静态说明，不影响文档能力本身的使用。',
      cfgDocSkillWord: 'office-word · Word 文档',
      cfgDocSkillExcel: 'office-excel · Excel 表格',
      cfgDocSkillPpt: 'office-ppt · PPT 演示',
      cfgDocSkillPdf: 'pdf-tools · PDF 工具',
      cfgDocSkillUnknown: '未检测',
      cfgColComponent: '组件',
      cfgColState: '状态',
      cfgColEvidence: '实测值',

      cfgGroupPet: '桌面形象',
      cfgPetLead:
        '桌面形象（workspace-tokenpet）的 14 项设置存在它自己的面板里（浏览器 localStorage）；本页只显示安装状态并提供跳转，不读写它的设置。',
      cfgPetOpen: '打开桌面形象面板',
      cfgPetOpenFailed: '未能自动定位设置面板 —— 请点左侧设置列表里的「用量小宠物」分区。',
      cfgPetState: '安装状态',
      cfgPetCheckFailed: '未能取到安装状态',
      cfgPetCheckHint: '取不到不代表未安装（可能安装清单路由未注册）。',
      cfgPetLocalNote: '本页不读写 localStorage，改动请在它自己的面板里做。',

      // 字段标签（cfgF<Key>）与说明（cfgH<Key>）：键名按 key 首字母大写拼接，
      // 保证 24 + 11 个键在两种语言下都有人话标签（接口 description 只作中文兜底）。
      cfgFPersonaLabel: '快照标题词',
      cfgHPersonaLabel: '注入快照的标题词，默认「记忆」',
      cfgFInjectMemory: '每轮注入记忆',
      cfgHInjectMemory: '关闭后记忆库仍可用，只是不再自动注入',
      cfgFSnapshotOrder: '快照顺序',
      cfgHSnapshotOrder: 'runtime 上下文里的顺序，越小越靠前（改动需重启 DSH 生效）',
      cfgFSnapshotMaxChars: '快照字符上限',
      cfgHSnapshotMaxChars: '超出后按优先级截断，并在截断处标注未注入条数',
      cfgFSnapshotLimitGlobal: '全局记忆条数上限',
      cfgHSnapshotLimitGlobal: '快照里「全局记忆」最多注入条数（全局永不归档）',
      cfgFSnapshotLimitUser: '用户偏好条数上限',
      cfgHSnapshotLimitUser: '快照里「用户偏好」最多注入条数（关键优先、近期优先）',
      cfgFSnapshotLimitProject: '项目记忆条数上限',
      cfgHSnapshotLimitProject: '快照里「项目记忆」最多注入条数',
      cfgFSnapshotLimitDaily: '今日日志条数上限',
      cfgHSnapshotLimitDaily: '快照里「今日日志」最多注入条数（取最近若干条）',
      cfgFArchiveEnabled: '冷热分层归档',
      cfgHArchiveEnabled: '到期热记忆转冷（ARCHIVE）；全局与关键永不归档',
      cfgFDailyRetentionDays: '日志保留天数',
      cfgHDailyRetentionDays: '更早的 DAILY 日志按周合并进 ARCHIVE',
      cfgFProjectTtlDays: '项目记忆 TTL（天）',
      cfgHProjectTtlDays: '超期转冷；关键永不，被用到过的顺延',
      cfgFUserTtlDays: '偏好记忆 TTL（天）',
      cfgHUserTtlDays: '超期转冷；关键永不，被用到过的顺延',
      cfgFTriageEnabled: '转冷预审',
      cfgHTriageEnabled: '关掉则到期即转冷（不再结合近期日志判断）',
      cfgFTriageGraceDays: '待判断宽限天数',
      cfgHTriageGraceDays: '超过仍未判定则自然转冷（0 = 不宽限）',
      cfgFTriageAskInSnapshot: '快照提醒待判断',
      cfgHTriageAskInSnapshot: '有待判断条目时在注入快照里提醒助手去判定',
      cfgFBackupEnabled: '自动备份',
      cfgHBackupEnabled: '写库时懒触发，每天至多一次',
      cfgFBackupDir: '备份目录',
      cfgHBackupDir: '留空使用默认目录',
      cfgFBackupKeep: '备份保留份数',
      cfgHBackupKeep: '保留最近多少份备份，更早的删除',
      cfgFMaintainWarnDays: '周保养提醒（天）',
      cfgHMaintainWarnDays: '距上次保养超过多少天时在快照里提醒（0 = 关闭）',
      cfgFGlobalWarnCount: '全局记忆告警阈值',
      cfgHGlobalWarnCount: '全局条数超过时在快照里提醒整理（0 = 关闭）',
      cfgFReviewEnabled: '关键条目先审后落盘',
      cfgHReviewEnabled: 'tag=关键 的记忆先进待确认队列，批准后才落盘',
      cfgFDailyAutoLog: '自动追加今日日志',
      cfgHDailyAutoLog: '每轮对话自动记一条活动日志（10 分钟防抖）',
      cfgFMemoryDir: '记忆库根目录',
      cfgHMemoryDir: '留空 = ~/.dsh/memories/<插件命名空间>',
      cfgFObsidianSyncDir: 'Obsidian 镜像目录',
      cfgHObsidianSyncDir: '留空 = 不同步；建议指向 vault 下的记忆镜像区',
      cfgFExpertsEnabled: '专家库总开关',
      cfgHExpertsEnabled: '关闭后不注入任何 persona；专家工具与命令仍可用',
      cfgFInjectOrder: '专家注入顺序',
      cfgHInjectOrder: 'runtime 上下文里的顺序，越小越靠前',
      cfgFDefaultDomain: '本人岗位域',
      cfgHDefaultDomain: '决定任务优先从哪个专业角度拆解，也是身份专家的兜底来源',
      cfgFIdentityExpert: '身份专家',
      cfgHIdentityExpert: '常驻注入的唯一身份专家 id（如 presales-ics-security）；留空 = 取岗位域第一位',
      cfgFEnabledDomains: '匹配范围·域',
      cfgHEnabledDomains: '逗号分隔（如 presales,legal）；留空 = 全部专家参与匹配',
      cfgFEnabledExperts: '匹配范围·专家',
      cfgHEnabledExperts: 'id 逗号分隔；留空 = 不收窄。范围外仍可用 /expert use 临时注入',
      cfgFExpertInjectMax: '每轮最多注入几位',
      cfgHExpertInjectMax: '默认 2：身份专家 + 至多 1 位按问题归属补位的对口专家；3 位会占更多 TOKEN',
      cfgFExpertInjectDetail: '注入形态',
      cfgHExpertInjectDetail: 'auto（默认，按预算自动降级）/ card（全部精简卡）/ full（全文，旧行为，单轮约 4.5–5.2KB）',
      cfgFExpertInjectBudgetChars: '每轮注入预算（字符）',
      cfgHExpertInjectBudgetChars: '默认 1400。超预算按序降级：命中全文 → 命中精简卡 → 只留身份卡；越小越省 TOKEN',
      cfgDetailAuto: 'auto（按预算自动降级）',
      cfgDetailCard: 'card（全部精简卡）',
      cfgDetailFull: 'full（全文，旧行为）',
      cfgFExpertSecondThreshold: '第 2/3 位门槛',
      cfgHExpertSecondThreshold: '其分数 ≥ 第 1 位 × 该值时才注入（仅注入上限 ≥ 2 时生效）',
      cfgFExpertMinScore: '最低注入分',
      cfgHExpertMinScore: '低于此分不注入 —— 短任务/无专业信号时保持通用助手行为',
      cfgFExpertShowBanner: '显示「当前专家视角」',
      cfgHExpertShowBanner: '注入时显示本轮用的是哪位专家',
      cfgFExpertSetupDone: '安装引导已完成',
      cfgHExpertSetupDone: '重置为关可让「你的工作方向是？」下次再问一次',
    }

    const EN = {
      nav: 'Work Secretary',
      title: 'Work Secretary',
      lead: 'One integrator for five capabilities. Environment check, dependency completion, sub-plugin installation and the setup wizard are ready; capability config arrives in a later version.',
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

      // ── Initialize / setup wizard (P3) ────────────────────────────
      tabInit: 'Initialize',
      initTitle: 'Setup wizard',
      initLead: 'Fill in the required first-run fields, review the plan, then write the configuration base in one go.',
      initLoading: 'Checking…',
      initLoadFailed: 'Setup information failed to load',
      initLoadFailedHint:
        'No data from the local service: the integrator may be disabled on the host side, or the route is not registered yet. Confirm, then press Retry.',
      initEmpty: 'The service returned no configuration items.',
      initStepForm: 'Fill in',
      initStepPreview: 'Check & preview',
      initStepRun: 'Apply',
      initStepDone: 'Result',
      initFormTitle: 'Required first-run fields',
      initFormHint: 'Fields marked * are required; leave the rest empty to use defaults.',
      initOptional: 'optional',
      initFieldWorkspace: 'Workspace directory',
      initFieldWorkspaceHint: 'Required; AGENTS.md and skills are written here',
      initFieldDomain: 'Job domain',
      initFieldDomainHint: 'Chooses the resident identity expert and default perspective',
      initFieldExpert: 'Identity expert',
      initFieldExpertHint: 'Empty = first expert of the job domain',
      initFieldMemoryDir: 'Memory directory',
      initFieldMemoryDirHint: 'Empty = default',
      initFieldObsidianDir: 'Obsidian vault directory',
      initFieldObsidianDirHint: 'If empty, memory is mirrored to <workspace>/work-memory (changeable later in settings).',
      initDomainPresales: 'Presales',
      initDomainAftersales: 'After-sales & support',
      initDomainFinance: 'Accounting & finance',
      initDomainLegal: 'Legal',
      initDomainDoc: 'Documents',
      initDomainGeneral: 'Verification & general',
      initDomainPlaceholder: 'Select…',
      initDomainRequired: 'Choose your job domain first',
      initBrowse: 'Browse…',
      initBrowseTip: 'Choose a directory',
      initBrowseUnavailable: 'The directory picker is unavailable in this shell; type the path manually.',
      initCandDetectedWorkspace: 'Use detected workspace',
      initCandDefaultMemory: 'Use default (~/.dsh/memories/{n})',
      initCandNoMirror: 'No mirror',
      initCandNeedWorkspace: 'Fill in the workspace first',
      initObsidianOffNote: 'No mirror selected',
      initCandMirrorAll: '<workspace>/00_全局记忆',
      initCandMirrorWork: '<workspace>/work-memory',
      initPickFailed: 'Directory picker failed: ',
      initWsFromClient: 'Workspace set by the client; please confirm',
      initWsFromConfig: 'Filled from the workspace setting',
      initWsFromDerived: 'Inferred from the memory mirror directory; please confirm',
      initWsFromCwd: 'Filled with the current working directory; please confirm',
      initWsFromDefault: 'Default workspace used; please confirm',
      initWsFromOther: 'Provided by the local service; please confirm',
      initWsRequired: 'A workspace must be selected',
      initCheckPreview: 'Check & preview',
      initChecking: 'Checking…',
      initRecheck: 'Re-check',
      initPlanTitle: 'Write plan',
      initPlanHint: 'This is a preview; no file has been changed yet.',
      initBackToForm: 'Back to edit',
      initFinish: 'Finish setup',
      initFinishing: 'Writing',
      initWriting: 'Writing…',
      initRunProgress: 'Writing {done}/{total}',
      initWriteFailTitle: 'Write failed',
      initWriteFailHint:
        'The local service may not support writing yet (dryRun:false), or the workspace is not writable. Run "Check & preview" to confirm the plan, then retry.',
      initWriteDryRun: 'The local service still treated this as a dry run (dryRun:true); nothing was written.',
      initWriteResult: 'Write result',
      initDoneTitle: 'Setup complete',
      initDonePartial: 'partly failed',
      initDoneRestart: 'Configuration written; restart DSH to take effect.',
      initDoneHint: 'After the restart the Work Secretary is ready to use. Fix any failed item and run setup again.',
      initColTarget: 'Target',
      initColBackup: 'Backup',
      initColBytes: 'Bytes written',
      initNoBackup: 'no backup needed',
      setupNeeded: '{n} item(s) still need setup before you can start. Click to finish setup.',
      setupGo: 'Finish setup',
      workspaceLabel: 'Workspace',
      workspaceNoneHint: 'Workspace path is not resolved, so submit is disabled. Fill in the workspace directory first.',
      wsSourceConfig: 'configured',
      wsSourceDefault: 'default',
      wsSourceNone: 'unset',
      initStatusAppend: 'will append',
      initStatusUpdate: 'will update',
      initStatusUpToDate: 'up to date',
      initStatusUserModified: 'edited by hand',
      initStatusAhead: 'ahead',
      initStatusBroken: 'broken',
      initStatusMultiple: 'multiple copies',
      initStatusNone: 'not found',
      initItemAgentsMd: 'AGENTS.md instructions',
      initItemMemorySeed: 'Memory seed',
      initItemSkills: 'Skills',
      initItemSettings: 'Settings',
      initItemDirs: 'Directories',
      initPlanAction: 'Planned action',
      initPreview: 'Preview',
      initPreviewHide: 'Hide preview',
      initPreviewEmpty: '(nothing to preview)',
      initPreviewMore: '… (first {n} lines only)',
      initBlockVersion: 'Block version',
      initContentHash: 'Content hash',
      initSummary: '{total} items · {toWrite} to write · {upToDate} up to date · {blocked} blocked',
      initSafety: 'Files are backed up before writing; AGENTS.md only updates the content inside the "Work Secretary" marker block — your own sections are left untouched.',
      initListSep: ', ',

      // ── Capabilities (P4: read/write sub-plugin settings) ─────────
      cfgLead:
        'Four groups: Memory, Experts, Documents, Desktop pet. Settings go through the local service (whitelisted namespaces, user layer) and never rewrite the config files you hand-edit.',
      cfgReload: 'Reload',
      cfgLoading: 'Loading…',
      cfgLastRead: 'Last read',
      cfgReloadFailed: 'Reload failed',
      cfgLoadFailed: 'Capability settings failed to load',
      cfgLoadFailedHint:
        'No settings from the local service: the integrator may be disabled on the host side, or the settings routes are not registered yet. Press Retry; this page never goes blank.',
      cfgRetry: 'Retry',
      cfgConflict: 'These settings were updated elsewhere, so they were reloaded. Your unsaved input is kept.',
      cfgSaved: 'Saved (applies without a restart).',
      cfgSaveFailed: 'Save failed',
      cfgSaveDryRun: 'The local service still treated this as a dry run (dryRun:true), so nothing was written; your changes stay in the draft.',
      cfgNoChange: 'Nothing to save.',
      cfgSkipped: '{n} value(s) skipped: the number format was invalid.',
      cfgOverride: 'overridden',
      cfgOverridePending: 'override pending removal',
      cfgUnset: 'Clear override',
      cfgRestore: 'Restore default',
      cfgSaveDraft: 'Save changes ({n})',
      cfgDirty: '{n} unsaved',
      cfgWritableNo: 'This namespace is read-only right now.',
      cfgNsUnavailable:
        'The local service does not expose this namespace — the sub-plugin may not be installed or enabled yet. Its settings appear here once it is ready.',
      cfgGroupOther: 'Other settings',
      cfgOn: 'on',
      cfgOff: 'off',
      cfgInjectMaxWarn: 'Injecting 2–3 experts uses more tokens (about 3.3–4.9KB each).',
      cfgRevision: 'revision r{n}',
      cfgAppliedLive: 'applies without a restart',

      cfgGroupMemory: 'Memory',
      cfgMemoryLead: 'Long-term execution memory (dsh-work-memory). Changes apply without a restart; keys you do not override keep the deployment defaults.',
      cfgMemGInject: 'Injection & snapshot',
      cfgMemGInjectHint: 'The per-turn injection switch and snapshot capacity',
      cfgMemGArchive: 'Hot/cold & archive',
      cfgMemGArchiveHint: 'When hot entries turn cold (ARCHIVE); key entries never do',
      cfgMemGTriage: 'Cold-triage pre-check',
      cfgMemGTriageHint: 'Due does not mean cold: recent logs and hot memory are weighed first',
      cfgMemGOps: 'Backup & operations',
      cfgMemGOpsHint: 'Auto backup, warning reminders and auto logging',
      cfgMemGDirs: 'Directories',
      cfgMemGDirsHint: 'Memory root and the Obsidian mirror directory; empty uses defaults',

      cfgGroupExperts: 'Experts',
      cfgExpertsLead: 'Domain expert library (dsh-experts). Only one identity expert is resident; the rest join when the task calls for them.',
      cfgExpGCore: 'Experts & match scope',
      cfgExpGCoreHint: 'Identity expert, job domain and the domains/experts that may match automatically',
      cfgExpGThreshold: 'Injection limits & detail',
      cfgExpGThresholdHint: 'How many experts are injected, how detailed (card or full), the character budget, and the minimum score',
      cfgExpPreview: 'Live preview',
      cfgExpPreviewHint: 'Type a task and preview the injected roster with scoring reasons (read-only, nothing is written)',
      cfgExpPreviewPlaceholder: 'e.g. How should the payment milestones and taxes of this contract be handled?',
      cfgExpPreviewGo: 'Preview',
      cfgExpPreviewRunning: 'Scoring…',
      cfgExpPreviewEmpty: 'Type a task, then press Preview.',
      cfgExpPreviewReason: 'Decision',
      cfgExpPreviewSelected: 'Injected roster',
      cfgExpPreviewNone: 'No expert reached the minimum score: this turn stays with the general assistant.',
      cfgExpPreviewConfig: 'Thresholds used',
      cfgExpPreviewColId: 'Expert',
      cfgExpPreviewColDomain: 'Domain',
      cfgExpPreviewColScore: 'Score',
      cfgExpPreviewColEvidence: 'Evidence',
      cfgExpPreviewColWhy: 'Reasons',
      cfgExpPreviewUnavailable: 'The expert library is not installed or enabled, so scoring preview is unavailable.',
      cfgExpPreviewFailed: 'Preview failed',
      cfgExpPreviewTruncated: 'Longer than 2000 characters: only the first 2000 were scored.',

      cfgGroupDocs: 'Documents',
      cfgDocLead: 'The document suite (dsh-doc-suite) has no settings of its own, so this shows self-check and dependency status.',
      cfgDocDeps: 'Dependency status',
      cfgDocDepsHint: 'Taken from the environment probe on the Install & Check page (read-only)',
      cfgDocSkills: 'Four skills on disk',
      cfgDocSkillHint: 'On-disk skill status comes from the document module self-check; this page only lists them, so a missing entry here does not mean a missing skill.',
      cfgDocDoctor: 'Run /doc-doctor inside the document module for a self-check; interpreters and WPS are never installed automatically.',
      cfgDocCheckFailed: 'Dependency status unavailable',
      cfgDocCheckHint: 'When the local service has no environment-check route, only the static notes are shown; document capability itself is unaffected.',
      cfgDocSkillWord: 'office-word · Word documents',
      cfgDocSkillExcel: 'office-excel · Excel sheets',
      cfgDocSkillPpt: 'office-ppt · PPT decks',
      cfgDocSkillPdf: 'pdf-tools · PDF tools',
      cfgDocSkillUnknown: 'not checked',
      cfgColComponent: 'Component',
      cfgColState: 'Status',
      cfgColEvidence: 'Observed',

      cfgGroupPet: 'Desktop pet',
      cfgPetLead:
        'The 14 desktop pet (workspace-tokenpet) settings live in its own panel (browser localStorage). This page only shows install status and offers a jump; it never reads or writes those settings.',
      cfgPetOpen: 'Open desktop pet panel',
      // workspace-tokenpet 的导航标签**不本地化**：中英文界面下都显示「用量小宠物」（2026-09-13 实测），
      // 所以这里也照实写它，避免提示指向一个界面上不存在的英文名。
      cfgPetOpenFailed: 'Could not locate the settings panel automatically — pick the "用量小宠物" section in the settings list on the left.',
      cfgPetState: 'Install status',
      cfgPetCheckFailed: 'Install status unavailable',
      cfgPetCheckHint: 'Unavailable does not mean missing (the install-list route may not be registered).',
      cfgPetLocalNote: 'This page never touches localStorage; make changes in the pet panel itself.',

      cfgFPersonaLabel: 'Snapshot title word',
      cfgHPersonaLabel: 'Title word of the injected snapshot, defaults to the memory label',
      cfgFInjectMemory: 'Inject memory each turn',
      cfgHInjectMemory: 'With this off the memory store still works, it is simply not injected automatically',
      cfgFSnapshotOrder: 'Snapshot order',
      cfgHSnapshotOrder: 'Position in the runtime context; smaller comes first (needs a DSH restart)',
      cfgFSnapshotMaxChars: 'Snapshot character limit',
      cfgHSnapshotMaxChars: 'Overflow is truncated by priority and the omitted count is noted',
      cfgFSnapshotLimitGlobal: 'Global entries limit',
      cfgHSnapshotLimitGlobal: 'Most global entries per snapshot (global memory never archives)',
      cfgFSnapshotLimitUser: 'User preference limit',
      cfgHSnapshotLimitUser: 'Most preference entries per snapshot (key and recent first)',
      cfgFSnapshotLimitProject: 'Project entries limit',
      cfgHSnapshotLimitProject: 'Most project entries per snapshot',
      cfgFSnapshotLimitDaily: 'Daily log limit',
      cfgHSnapshotLimitDaily: 'Most daily-log entries per snapshot (most recent ones)',
      cfgFArchiveEnabled: 'Hot/cold archiving',
      cfgHArchiveEnabled: 'Due hot entries turn cold (ARCHIVE); global and key entries never do',
      cfgFDailyRetentionDays: 'Daily log retention (days)',
      cfgHDailyRetentionDays: 'Older daily logs are merged weekly into ARCHIVE',
      cfgFProjectTtlDays: 'Project TTL (days)',
      cfgHProjectTtlDays: 'Turns cold after the TTL; key entries never, used entries are extended',
      cfgFUserTtlDays: 'Preference TTL (days)',
      cfgHUserTtlDays: 'Turns cold after the TTL; key entries never, used entries are extended',
      cfgFTriageEnabled: 'Cold-triage pre-check',
      cfgHTriageEnabled: 'Off means entries turn cold as soon as they are due',
      cfgFTriageGraceDays: 'Pending decision grace (days)',
      cfgHTriageGraceDays: 'Undecided entries turn cold after the grace period (0 = no grace)',
      cfgFTriageAskInSnapshot: 'Remind in snapshot',
      cfgHTriageAskInSnapshot: 'Remind the assistant in the snapshot when entries await a decision',
      cfgFBackupEnabled: 'Automatic backup',
      cfgHBackupEnabled: 'Lazily triggered on writes, at most once a day',
      cfgFBackupDir: 'Backup directory',
      cfgHBackupDir: 'Empty uses the default directory',
      cfgFBackupKeep: 'Backups to keep',
      cfgHBackupKeep: 'Keep the most recent backups and delete older ones',
      cfgFMaintainWarnDays: 'Maintenance reminder (days)',
      cfgHMaintainWarnDays: 'Remind in the snapshot after this many days without maintenance (0 = off)',
      cfgFGlobalWarnCount: 'Global entry warning',
      cfgHGlobalWarnCount: 'Remind in the snapshot when global entries exceed this count (0 = off)',
      cfgFReviewEnabled: 'Review key entries first',
      cfgHReviewEnabled: 'Key-tagged memories wait in a confirmation queue until approved',
      cfgFDailyAutoLog: 'Append a daily log',
      cfgHDailyAutoLog: 'Add one activity line per turn (10 minute debounce)',
      cfgFMemoryDir: 'Memory root directory',
      cfgHMemoryDir: 'Empty = ~/.dsh/memories/<plugin namespace>',
      cfgFObsidianSyncDir: 'Obsidian mirror directory',
      cfgHObsidianSyncDir: 'Empty = no mirror; point it at the memory mirror area of your vault',
      cfgFExpertsEnabled: 'Expert library master switch',
      cfgHExpertsEnabled: 'With this off no persona is injected; expert tools and commands still work',
      cfgFInjectOrder: 'Expert injection order',
      cfgHInjectOrder: 'Position in the runtime context; smaller comes first',
      cfgFDefaultDomain: 'Job domain',
      cfgHDefaultDomain: 'Decides which perspective leads the breakdown; also the fallback source of the identity expert',
      cfgFIdentityExpert: 'Identity expert',
      cfgHIdentityExpert: 'Id of the single resident expert (e.g. presales-ics-security); empty = first expert of the job domain',
      cfgFEnabledDomains: 'Match scope · domains',
      cfgHEnabledDomains: 'Comma separated (e.g. presales,legal); empty = every expert may match',
      cfgFEnabledExperts: 'Match scope · experts',
      cfgHEnabledExperts: 'Comma separated ids; empty = no narrowing. Experts outside the scope can still be injected with /expert use',
      cfgFExpertInjectMax: 'Experts per turn',
      cfgHExpertInjectMax: 'Default 2: the identity expert plus at most one task-matched expert; 3 costs more tokens',
      cfgFExpertInjectDetail: 'Injection detail',
      cfgHExpertInjectDetail: 'auto (default, budget-driven) / card (compact cards only) / full (full personas, about 4.5–5.2 KB per turn)',
      cfgFExpertInjectBudgetChars: 'Injection budget (characters)',
      cfgHExpertInjectBudgetChars: 'Default 1400. Over budget it degrades in order: full persona → compact card → identity card only; smaller saves tokens',
      cfgDetailAuto: 'auto (budget-driven)',
      cfgDetailCard: 'card (compact cards only)',
      cfgDetailFull: 'full (full personas)',
      cfgFExpertSecondThreshold: '2nd/3rd cutoff',
      cfgHExpertSecondThreshold: 'A candidate needs score ≥ top score × this value (only with a limit of 2 or more)',
      cfgFExpertMinScore: 'Minimum score',
      cfgHExpertMinScore: 'Below this nothing is injected — short or generic tasks stay with the general assistant',
      cfgFExpertShowBanner: 'Show the current expert perspective',
      cfgHExpertShowBanner: 'Shows which expert is in use for this turn',
      cfgFExpertSetupDone: 'Setup wizard finished',
      cfgHExpertSetupDone: 'Reset to off to be asked about your job domain again',
    }

    /** 包含的五个子插件（不写版本号：版本随使用者安装情况而变，由后续安装器探测） */
    const PLUGINS = [
      ['dsh-work-memory', '记忆库', '自研', 'MIT', '执行层长期记忆：三级记忆模型 + 转冷预审 + 侧边栏记忆面板'],
      ['dsh-doc-suite', '文档能力', '自研', 'MIT', 'Word / Excel / PPT / PDF 四格式处理与只读精确提取（需 Python 与 WPS）'],
      ['dsh-experts', '专家库', '自研', 'MIT', '按岗位关联的专家 persona：常驻一位身份专家，其余按问题归属补位或派子代理'],
      ['dsh-mermaid', '思维链与图表', '第三方', 'MIT', '把 Mermaid 代码块渲染成流程图 / 时序图，可切换图与代码'],
      ['workspace-tokenpet', '桌面形象', '独立项目模块', 'MIT', '桌面宠物外观与动作（自持源码与素材；致谢见模块 NOTICE）'],
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

      // ── 配置引导（P3：四段式向导 + 表单） ─────────────────────────
      wizSteps: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' },
      wizStep: {
        display: 'flex', gap: '6px', alignItems: 'center', border: '1px solid #eef0f2',
        background: '#fbfbfc', borderRadius: '8px', padding: '5px 9px',
      },
      wizStepOn: { borderColor: '#c7d2fe', background: '#f3f6ff' },
      wizStepDone: { background: '#f4fbf7', borderColor: '#d6efe1' },
      wizNo: {
        width: '18px', height: '18px', borderRadius: '50%', background: '#e8eaf0', color: '#4b5563',
        fontSize: '11px', fontWeight: 650, display: 'flex', alignItems: 'center', justifyContent: 'center',
      },
      wizNoOn: { background: '#1d4ed8', color: '#fff' },
      wizNoDone: { background: '#16794a', color: '#fff' },
      wizName: { fontSize: '12.5px', color: '#6b7280' },
      wizNameOn: { color: '#1d4ed8', fontWeight: 600 },
      field: { display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '10px' },
      fieldRow: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      fieldCol: { flex: '1 1 220px', minWidth: '200px' },
      label: { fontSize: '12.5px', fontWeight: 600, color: '#374151' },
      labelHint: { fontSize: '11.5px', color: '#8a8f98', fontWeight: 400 },
      input: {
        width: '100%', boxSizing: 'border-box', border: '1px solid #dfe1e5', borderRadius: '8px',
        padding: '6px 9px', fontSize: '12.5px', fontFamily: 'inherit', color: '#1f2328', background: '#fff',
      },
      select: {
        width: '100%', boxSizing: 'border-box', border: '1px solid #dfe1e5', borderRadius: '8px',
        padding: '6px 9px', fontSize: '12.5px', fontFamily: 'inherit', color: '#1f2328', background: '#fff',
      },
      reqMark: { color: '#b42318', marginLeft: '2px' },
      setupBar: {
        display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
        background: '#f3f6ff', border: '1px solid #c7d2fe', borderRadius: '12px', padding: '10px 12px', marginBottom: '12px',
      },
      setupText: { fontSize: '13px', color: '#2b4c9b', fontWeight: 550 },
      inputRow: { display: 'flex', gap: '6px', alignItems: 'center' },
      candRow: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' },
      candBtn: {
        appearance: 'none', border: '1px solid #e3e5e9', background: '#f7f8f9', borderRadius: '7px',
        padding: '3px 8px', fontSize: '11.5px', fontFamily: 'inherit', cursor: 'pointer',
        color: '#4b5563', lineHeight: 1.4,
      },
      candBtnOn: { borderColor: '#c7d2fe', background: '#f3f6ff', color: '#2b4c9b' },
      labelHintOn: { fontSize: '11.5px', color: '#2b4c9b', fontWeight: 550 },

      // ── 能力配置（P4：设置项 / 阈值滑块 / 预览与状态面板） ─────────
      cfgHead: {
        display: 'flex', gap: '10px', alignItems: 'flex-start', justifyContent: 'space-between',
        flexWrap: 'wrap', margin: '2px 0 10px',
      },
      cfgLead: { fontSize: '12.5px', color: '#6b7280', maxWidth: '640px' },
      cfgNoticeOk: {
        border: '1px solid #d6efe1', background: '#f4fbf7', color: '#16794a',
        borderRadius: '10px', padding: '8px 11px', fontSize: '12.5px', marginBottom: '10px',
      },
      cfgNoticeWarn: {
        border: '1px solid #f6e3c4', background: '#fff9ef', color: '#8a5300',
        borderRadius: '10px', padding: '8px 11px', fontSize: '12.5px', marginBottom: '10px',
      },
      cfgSection: { marginTop: '12px' },
      // 插件级标签栏（能力配置页顶部：重新读取那一行下方）
      cfgGroupTabs: { display: 'flex', gap: '2px', flexWrap: 'wrap', borderBottom: '1px solid #eceef1', margin: '2px 0 12px' },
      cfgGroupTab: (on) => ({
        appearance: 'none', border: 0, background: 'transparent', cursor: 'pointer',
        padding: '7px 12px', fontSize: '13px', fontFamily: 'inherit',
        color: on ? '#111827' : '#6b7280', fontWeight: on ? 650 : 400,
        borderBottom: on ? '2px solid #111827' : '2px solid transparent', marginBottom: '-1px',
      }),
      cfgSectionTitle: { fontSize: '12.5px', fontWeight: 650, color: '#374151', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      cfgSectionHint: { fontSize: '11.5px', color: '#8a8f98', margin: '2px 0 6px' },
      cfgRow: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid #f6f7f9', flexWrap: 'wrap' },
      cfgColLabel: { flex: '0 0 210px', minWidth: '160px' },
      cfgColControl: { flex: '1 1 240px', minWidth: '200px' },
      cfgLabelText: { fontSize: '12.5px', fontWeight: 600, color: '#374151', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' },
      cfgHintText: { fontSize: '11.5px', color: '#8a8f98', marginTop: '2px' },
      cfgNum: {
        width: '104px', boxSizing: 'border-box', border: '1px solid #dfe1e5', borderRadius: '8px',
        padding: '5px 8px', fontSize: '12.5px', fontFamily: 'inherit', color: '#1f2328', background: '#fff',
      },
      cfgSlider: { display: 'flex', gap: '8px', alignItems: 'center' },
      cfgRange: { flex: '1 1 140px', minWidth: '120px', accentColor: '#1d4ed8' },
      cfgRangeValue: { fontFamily: 'Consolas, "Courier New", monospace', fontSize: '11.5px', color: '#4b5563', minWidth: '48px' },
      cfgSwitch: { display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '12.5px', color: '#4b5563', cursor: 'pointer' },
      cfgRowActions: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' },
      cfgDirty: { fontSize: '11.5px', color: '#2b4c9b' },
      cfgSaveBar: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed #e6e7ea' },
      cfgPreviewBox: { marginTop: '10px', border: '1px solid #eef0f2', borderRadius: '10px', padding: '10px 12px', background: '#fbfbfc' },
      cfgPreviewHead: { fontSize: '12.5px', fontWeight: 650, color: '#374151', marginBottom: '2px' },
      cfgPreviewInput: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' },
      cfgChips: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0' },
      cfgTh: { textAlign: 'left', color: '#8a8f98', fontWeight: 600, fontSize: '11.5px', padding: '5px 7px', borderBottom: '1px solid #eceef1' },
      cfgTd: { padding: '6px 7px', borderBottom: '1px solid #f6f7f9', verticalAlign: 'top', fontSize: '12px' },
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

    /** 一次替换所有 {key} 占位（汇总行有多个计数，中英语序不同） */
    function fillAll(text, map) {
      return String(text).replace(/\{(\w+)\}/g, (all, key) =>
        (map && map[key] !== undefined && map[key] !== null) ? String(map[key]) : all)
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

    // ── P3「初始化」：/basedeck（dry-run 计划）响应归一化（字段一律容错） ──

    function initStatusLabel(t, status) {
      const key = INIT_STATUS_KEYS[status]
      return key ? t(key) : t('statusUnknown')
    }

    /** 状态 → 徽标样式：up_to_date 绿 / append·update 蓝 / user_modified·ahead 橙 / broken·multiple 红 / 其余灰 */
    function initStatusStyle(status) {
      if (status === 'up_to_date') return S.badgeOk
      if (status === 'append' || status === 'update') return S.badgeBrand
      if (status === 'user_modified' || status === 'ahead') return S.badgeWarn
      if (status === 'broken' || status === 'multiple') return S.badgeMissing
      return S.badgeSkip
    }

    /** target 可能是单个路径，也可能是路径列表；列表连成一行（接口原样回显，不臆造） */
    function targetText(target, t) {
      if (Array.isArray(target)) return target.map((x) => String(x)).join(t('initListSep'))
      if (typeof target === 'string') return target
      if (target === undefined || target === null) return ''
      return String(target)
    }

    /** preview.sampleLines 可能是数组或含换行的字符串；最多保留 INIT_PREVIEW_MAX 行 */
    function sampleLines(preview) {
      const raw = preview ? preview.sampleLines : null
      let lines = []
      if (Array.isArray(raw)) lines = raw.map((x) => String(x))
      else if (typeof raw === 'string') lines = raw.split(/\r?\n/)
      const overflow = lines.length > INIT_PREVIEW_MAX
      return { lines: lines.slice(0, INIT_PREVIEW_MAX), overflow: overflow, empty: lines.length === 0 }
    }

    /** 归一化一项初始化计划；raw 为 null 表示接口没返回该项（只渲染骨架） */
    function normalizeInitItem(raw, id, t) {
      const r = (raw && typeof raw === 'object') ? raw : null
      const labelKey = INIT_LABEL_KEYS[id] || ''
      const fallback = labelKey ? t(labelKey) : ''
      const name = (r && firstText(r.label, r.name, r.title))
        || ((fallback && fallback !== labelKey) ? fallback : id)
      const preview = (r && r.preview && typeof r.preview === 'object') ? r.preview : null
      return {
        id: id,
        name: name,
        status: (r && typeof r.status === 'string') ? r.status : '',
        target: targetText(r && r.target, t),
        detail: (r && typeof r.detail === 'string') ? r.detail : '',
        preview: preview,
        action: (preview && typeof preview.action === 'string') ? preview.action : '',
        blockVersion: preview ? firstText(preview.blockVersion) : '',
        contentHash: preview ? firstText(preview.contentHash) : '',
        autoApplyable: Boolean(r && r.autoApplyable === true),
      }
    }

    /** 归一化单项写入结果（POST /basedeck 逐项元素；字段容错） */
    function normalizeWrite(body, id, t, fallbackMsg) {
      const b = (body && typeof body === 'object') ? body : {}
      const bytes = (typeof b.bytesWritten === 'number' && isFinite(b.bytesWritten))
        ? b.bytesWritten
        : ((typeof b.writtenBytes === 'number' && isFinite(b.writtenBytes)) ? b.writtenBytes : null)
      const detail = firstText(b.detail)
      const errText = firstText(b.error, b.message)
      // 服务端明确回 dryRun:true —— 说明本次并没有真正写盘，不能算成功
      const stillDry = b.dryRun === true
      const ok = b.ok !== false && !stillDry
      const message = !ok
        ? (errText || detail || (stillDry ? t('initWriteDryRun') : fallbackMsg))
        : ''
      return {
        id: typeof b.id === 'string' ? b.id : id,
        ok: ok,
        dryRun: b.dryRun === false ? false : (stillDry ? true : null),
        action: firstText(b.action),
        target: targetText(b.target, t),
        backup: targetText(b.backup, t),
        bytesWritten: bytes,
        detail: detail,
        message: message,
      }
    }

    /** 写入失败 / 网络异常的归一化结果（与结果行同构） */
    function failedWrite(id, msg) {
      return {
        id: id, ok: false, dryRun: null, action: '', target: '',
        backup: '', bytesWritten: null, detail: '', message: String(msg),
      }
    }

    /** setupNeeded 为 true 时，「还差几项」的计数（缺字段时按 summary 兜底） */
    function setupCount(body) {
      const items = (body && Array.isArray(body.items)) ? body.items : []
      let n = 0
      for (const it of items) {
        if (!it || typeof it !== 'object') continue
        if (typeof it.status === 'string' && it.status !== '' && it.status !== 'up_to_date') n++
      }
      if (n > 0) return n
      const s = (body && body.summary && typeof body.summary === 'object') ? body.summary : {}
      const w = (typeof s.toWrite === 'number' && isFinite(s.toWrite)) ? s.toWrite : 0
      const b = (typeof s.blocked === 'number' && isFinite(s.blocked)) ? s.blocked : 0
      return w + b
    }

    /** 取路径最后一段（工作区目录名通常就是记忆库名） */
    function baseName(p) {
      const s = String(p || '').replace(/[\\/]+$/, '')
      const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
      return i >= 0 ? s.slice(i + 1) : s
    }

    /** 拼接路径：沿用工作区自身的分隔符风格（Windows 反斜杠 / 其它正斜杠） */
    function joinPath(base, seg) {
      const b = String(base || '').replace(/[\\/]+$/, '')
      if (!b) return ''
      const sep = (b.indexOf('\\') >= 0 && b.indexOf('/') < 0) ? '\\' : '/'
      return b + sep + String(seg || '')
    }

    /** workspaceSource → 工作区字段下方的来源说明键（none 时提示必须选择） */
    function wsSourceNoteKey(source) {
      if (source === 'none') return 'initWsRequired'
      if (source === 'client') return 'initWsFromClient'
      if (source === 'config') return 'initWsFromConfig'
      if (source === 'derived') return 'initWsFromDerived'
      if (source === 'cwd') return 'initWsFromCwd'
      if (source === 'default') return 'initWsFromDefault'
      return 'initWsFromOther'
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

    /**
     * 设置页专用请求：与 requestJson 同源同基址，差别只在**不把 4xx 当异常** ——
     * 409（revision 冲突）与 404（路由未注册）都要读响应体才能给出可读提示。
     * 返回 { ok, status, body }；只有「连响应都拿不到」才抛错。
     * 既有页面继续用 requestJson / getJson / postJson，行为完全不变。
     */
    async function requestJsonFull(pathWithQuery, init, timeoutMs) {
      const rel = API + pathWithQuery
      const abs = new URL(rel, HOST_BASE).toString()
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
          if (!res) throw new Error('无响应')
          let body = null
          try { body = await res.json() } catch (e) { body = null }
          const status = (typeof res.status === 'number' && isFinite(res.status)) ? res.status : (res.ok === false ? 0 : 200)
          if (res.ok !== false && status < 400) return { ok: true, status: status, body: body }
          if (body && typeof body === 'object') return { ok: false, status: status, body: body }
          // 服务端已应答（只是没有 JSON 体）→ 不再换基址重试，直接把状态码交给页面
          return { ok: false, status: status, body: null }
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
        ['init', t('tabInit')],
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
        const isCurrent = s[0] === current
        // P3：「初始化」是最后一步，也是唯一带 later 标记却可能成为当前步的一步；
        // 只有它真的成为当前步时才取消「后续版本」标记（P1/P2 的显示不变）。
        const later = s[2] === 'later' && !isCurrent
        const on = !later && isCurrent
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

    /** 初始化清单一行：中文名 · 状态徽标 · 计划动作 · 目标路径 · 说明 · 可展开预览（最多 20 行） */
    function InitRow(props) {
      const t = props.t
      const item = props.item
      const open = Boolean(props.open)
      const hasPreview = Boolean(item.preview)
      const lines = sampleLines(item.preview)
      const meta = []
      if (item.blockVersion) meta.push(t('initBlockVersion') + ' ' + item.blockVersion)
      if (item.contentHash) meta.push(t('initContentHash') + ' ' + item.contentHash)
      const nodes = [
        h('div', { key: 'head', style: S.rowHead }, [
          h('span', { key: 'nm', style: S.itemName }, item.name),
          h('span', { key: 'st', style: Object.assign({}, S.badge, initStatusStyle(item.status)) },
            initStatusLabel(t, item.status)),
          item.action ? h('span', { key: 'ac', style: S.actionHint }, t('initPlanAction') + ': ' + item.action) : null,
        ]),
      ]
      if (item.target) nodes.push(h('div', { key: 'tg', style: S.itemValue }, item.target))
      if (item.detail) nodes.push(h('div', { key: 'dt', style: S.itemDetail }, renderDetail(item.detail)))
      if (hasPreview) {
        nodes.push(h('div', { key: 'act', style: S.actions }, [
          h('button', {
            key: 'pv', type: 'button', style: S.btn,
            onClick: () => props.onToggle(item.id),
          }, open ? t('initPreviewHide') : t('initPreview')),
          meta.length ? h('span', { key: 'meta', style: S.actionHint }, meta.join(' · ')) : null,
        ]))
      }
      if (open && hasPreview) {
        nodes.push(h('div', { key: 'lines', style: S.out }, lines.empty
          ? t('initPreviewEmpty')
          : ((lines.overflow ? fill(t('initPreviewMore'), INIT_PREVIEW_MAX) + '\n' : '') + lines.lines.join('\n'))))
      }
      return h('div', { style: S.row }, nodes)
    }

    /** 四段式向导进度条（当前段由页面用 props.stage 指定） */
    function WizSteps(props) {
      const t = props.t
      const order = WIZ_STEPS.map((x) => x[0])
      const cur = order.indexOf(String(props.stage || 'form'))
      return h('div', { style: S.wizSteps }, WIZ_STEPS.map((s, i) => {
        const on = s[0] === props.stage
        const done = cur >= 0 && i < cur
        return h('div', {
          key: s[0],
          style: Object.assign({}, S.wizStep, on ? S.wizStepOn : null, done ? S.wizStepDone : null),
        }, [
          h('span', { key: 'n', style: Object.assign({}, S.wizNo, on ? S.wizNoOn : null, done ? S.wizNoDone : null) }, String(i + 1)),
          h('span', { key: 'x', style: Object.assign({}, S.wizName, on ? S.wizNameOn : null) }, t(s[1])),
        ])
      }))
    }

    /** 写入结果一行：中文名 · 状态 · 动作 · 目标 · 备份 · 写入字节 · 说明 */
    function InitResultRow(props) {
      const t = props.t
      const item = props.item
      const panel = props.panel
      const state = props.state || 'wait'
      const nodes = [
        h('div', { key: 'head', style: S.runHead }, [
          h('span', { key: 'nm', style: S.itemName }, item.name),
          h('span', { key: 'st', style: Object.assign({}, S.badge, runStateStyle(state)) },
            t(WRITE_STATE_KEYS[state] || 'runWait')),
        ]),
      ]
      if (panel) {
        if (panel.action) nodes.push(h('div', { key: 'ac', style: S.itemDetail }, t('initPlanAction') + ': ' + panel.action))
        if (panel.target) nodes.push(h('div', { key: 'tg', style: S.itemValue }, t('initColTarget') + ': ' + panel.target))
        const kv = []
        if (panel.backup) kv.push(['bk', t('initColBackup'), panel.backup])
        else if (state === 'ok') kv.push(['bk', t('initColBackup'), t('initNoBackup')])
        if (panel.bytesWritten !== null && panel.bytesWritten !== undefined) {
          kv.push(['by', t('initColBytes'), String(panel.bytesWritten)])
        }
        if (kv.length) nodes.push(h('div', { key: 'kv', style: S.kv }, kv.map((r) => h('div', { key: r[0], style: S.kvRow }, [
          h('span', { key: 'k', style: S.kvKey }, r[1]),
          h('span', { key: 'v', style: S.kvVal }, r[2]),
        ]))))
        if (panel.detail && panel.detail !== panel.message) nodes.push(h('div', { key: 'dt', style: S.note }, panel.detail))
        if (panel.message) nodes.push(h('div', { key: 'msg', style: S.warnLine }, panel.message))
      }
      return h('div', { style: S.runEntry }, nodes)
    }

    /**
     * 「初始化」页（P3）：**配置引导（setup wizard）**。
     * 四段式：填写配置 → 检查与预览 → 执行 → 结果。
     * - 进入自动 GET /basedeck（不带 workspace）预填当前工作区；
     * - 「检查并预览」→ GET /basedeck?workspace=<表单值>（只读，写前先看）；
     * - 「完成配置」→ 按 WRITE_ORDER **逐个** POST /basedeck { ids:[id], dryRun:false, overrides }
     *   —— 逐项实时状态；整批 POST 仅在请求层失败且尚无成功响应时兜底；
     * - 完成后需重启 DSH 生效；接口不支持 dryRun:false 时给可读失败提示，不假装成功。
     */
    function InitPage(props) {
      const t = props.t
      const state = useState({
        stage: 'form', busy: false, items: [], workspace: '', workspaceSource: '',
        summary: null, error: '', writeError: '', pickError: '', open: {},
        detected: '', libraryName: '', memoryRoot: '~/.dsh/memories', obsidianOff: false,
        form: { workspace: '', domain: '', identityExpert: '', memoryDir: '', obsidianSyncDir: '' },
        batch: null,
      })
      const st = state[0]
      const setSt = state[1]

      function setField(key, value) {
        setSt((prev) => {
          const patch = { form: Object.assign({}, prev.form, { [key]: value }) }
          // 手输路径 / 点镜像候选（值为非空）→ 退出 Obsidian「显式关闭」状态
          if (key === 'obsidianSyncDir' && String(value === undefined || value === null ? '' : value) !== '') {
            patch.obsidianOff = false
          }
          return Object.assign({}, prev, patch)
        })
      }

      /** 「不使用镜像」：进入**显式关闭**状态（提交时上报哨兵值 OBSIDIAN_NO_MIRROR） */
      function chooseNoMirror() {
        setSt((prev) => Object.assign({}, prev, {
          obsidianOff: true,
          form: Object.assign({}, prev.form, { obsidianSyncDir: '' }),
        }))
      }

      /**
       * 原生目录选择（可选能力）：服务缺失时按钮禁用；
       * 使用者取消（返回 null / 空串）时**保持原值不变**；选择失败给可读提示，不崩。
       */
      const pick = (typeof props.pickDirectory === 'function') ? props.pickDirectory : null
      async function browse(field) {
        if (!pick) return
        try {
          const chosen = await pick()
          if (typeof chosen === 'string' && chosen.trim() !== '') setField(field, chosen.trim())
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, {
            pickError: t('initPickFailed') + String((err && err.message) || err),
          }))
        }
      }

      /** 快捷候选按钮：点一下就填；不可用时禁用并说明原因 */
      function candidate(field, key, text, value, enabled, active, onPick) {
        const on = enabled === true
        return h('button', {
          key: key, type: 'button',
          disabled: !on,
          title: on ? undefined : t('initCandNeedWorkspace'),
          style: Object.assign({}, S.candBtn, on ? null : S.btnDisabled, active === true ? S.candBtnOn : null),
          onClick: typeof onPick === 'function' ? onPick : (() => setField(field, value)),
        }, text)
      }

      /** 目录输入行：输入框 + 「浏览…」（本机服务不可用时禁用 + tooltip） */
      function dirRow(field, value, placeholder) {
        const available = Boolean(pick)
        return h('div', { key: 'row', style: S.inputRow }, [
          h('input', {
            key: 'i', type: 'text', style: S.input, value: value, placeholder: placeholder,
            onChange: (e) => setField(field, e && e.target ? e.target.value : ''),
          }),
          h('button', {
            key: 'b', type: 'button',
            disabled: !available,
            title: available ? t('initBrowseTip') : t('initBrowseUnavailable'),
            // 「浏览…」必须整词显示：不加 nowrap + flexShrink:0 时会被输入框挤到换行，
            // 在窄栏里显示成「浏」/「览…」两行（2026-09-13 真机截图发现）。
            style: Object.assign({}, S.btn, { whiteSpace: 'nowrap', flexShrink: 0 }, available ? null : S.btnDisabled),
            onClick: () => browse(field),
          }, t('initBrowse')),
        ])
      }

      function toggleOpen(id) {
        setSt((prev) => {
          const next = Object.assign({}, prev.open)
          next[id] = !next[id]
          return Object.assign({}, prev, { open: next })
        })
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

      /** 首屏：GET /basedeck（不带 workspace）—— 只用于预填当前工作区 */
      async function boot() {
        setSt((prev) => Object.assign({}, prev, { stage: 'form', busy: true, error: '', writeError: '' }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const body = await getJson('/basedeck', 15000)
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          if (body.ok === false) throw new Error(String(body.error || 'basedeck 返回 ok:false'))
          const ws = typeof body.workspace === 'string' ? body.workspace.trim() : ''
          const src = typeof body.workspaceSource === 'string' ? body.workspaceSource.trim() : ''
          // 只有 none 才留空（此时必须由使用者选择）；client/config/derived/cwd/default 一律预填
          const isNone = src === 'none'
          const lib = firstText(body.libraryName, body.memoryLibrary) || baseName(ws)
          const memRoot = firstText(body.memoryRoot, body.defaultMemoryRoot) || '~/.dsh/memories'
          setSt((prev) => Object.assign({}, prev, {
            stage: 'form', busy: false, error: '',
            items: Array.isArray(body.items) ? body.items : [],
            workspace: ws,
            workspaceSource: src,
            detected: ws,
            libraryName: lib,
            memoryRoot: memRoot,
            summary: (body.summary && typeof body.summary === 'object') ? body.summary : null,
            form: Object.assign({}, prev.form, {
              workspace: isNone ? '' : (prev.form.workspace || ws),
            }),
          }))
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, { stage: 'form', busy: false, error: String((err && err.message) || err) }))
        }
      }

      /** 「检查并预览」：GET /basedeck?workspace=<表单值>（只读） */
      async function checkPreview() {
        const ws = String(st.form.workspace || '').trim()
        setSt((prev) => Object.assign({}, prev, { stage: 'preview', busy: true, error: '', writeError: '', open: {} }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const body = await getJson('/basedeck' + (ws ? ('?workspace=' + encodeURIComponent(ws)) : ''), 15000)
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          if (body.ok === false) throw new Error(String(body.error || 'basedeck 返回 ok:false'))
          setSt((prev) => Object.assign({}, prev, {
            stage: 'preview', busy: false, error: '',
            items: Array.isArray(body.items) ? body.items : [],
            workspace: typeof body.workspace === 'string' ? body.workspace.trim() : ws,
            workspaceSource: typeof body.workspaceSource === 'string' ? body.workspaceSource.trim() : '',
            summary: (body.summary && typeof body.summary === 'object') ? body.summary : null,
          }))
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, { stage: 'form', busy: false, error: String((err && err.message) || err) }))
        }
      }

      /**
       * 「重新检查」：**只刷新当前所在步骤**的数据，绝不代替使用者跳步。
       * 第 1 步（填写配置）重新探测工作区与必配项，停在 form；
       * 第 2 步及之后（检查与预览 / 结果）重新预览，停在 preview。
       */
      function recheck() {
        if (st.stage === 'form') return boot()
        return checkPreview()
      }

      /**
       * 「完成配置」：按 WRITE_ORDER 逐个 POST /basedeck { ids:[id], dryRun:false, overrides }。
       * 每步完成立刻刷新该项状态（等待 / 写入中 / 成功 / 失败）与结果。
       * 兜底：逐个请求在「请求层」失败、且本次尚无成功响应（典型：路由未注册）时，
       * 整体回退到一次 POST { ids: 全部 }，按返回的逐项结果回填。
       */
      async function finish() {
        if (st.busy || st.stage === 'running') return
        const ids = WRITE_ORDER.slice()
        const overrides = {
          workspace: String(st.form.workspace || '').trim(),
          defaultDomain: String(st.form.domain || ''),
          identityExpert: String(st.form.identityExpert || '').trim(),
          memoryDir: String(st.form.memoryDir || '').trim(),
          obsidianSyncDir: st.obsidianOff ? OBSIDIAN_NO_MIRROR : String(st.form.obsidianSyncDir || '').trim(),
        }
        const initState = {}
        for (const id of ids) initState[id] = 'wait'
        setSt((prev) => Object.assign({}, prev, {
          stage: 'running', busy: true, writeError: '',
          batch: { running: true, order: ids, state: initState, results: {} },
        }))
        const results = {}
        const states = {}
        let servedAny = false
        let fallback = false
        for (const id of ids) {
          setBatchState(id, 'run')
          let panel = null
          let transportFailed = false
          try {
            const body = await postJson('/basedeck', { ids: [id], dryRun: false, overrides: overrides })
            if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
            panel = normalizeWrite(body, id, t, t('initWriteFailTitle'))
            servedAny = true
          } catch (err) {
            transportFailed = true
            panel = failedWrite(id, String((err && err.message) || err))
          }
          results[id] = panel
          states[id] = panel.ok ? 'ok' : 'fail'
          setSt((prev) => {
            const batch = prev.batch || { order: ids, state: {}, results: {} }
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
          try {
            const body = await postJson('/basedeck', { ids: ids, dryRun: false, overrides: overrides })
            const list = fixAllList(body)
            if (!list) throw new Error('响应不含逐项结果')
            list.forEach((x, i) => {
              const id = (x && typeof x.id === 'string') ? x.id : ids[i]
              if (!id) return
              const panel = normalizeWrite(x, id, t, t('initWriteFailTitle'))
              results[id] = panel
              states[id] = panel.ok ? 'ok' : 'fail'
            })
            if (!Object.keys(results).length) throw new Error('响应逐项结果为空')
          } catch (err) {
            const msg = String((err && err.message) || err)
            for (const id of ids) {
              if (!states[id] || states[id] === 'wait') {
                results[id] = results[id] || failedWrite(id, msg)
                states[id] = 'fail'
              }
            }
            setSt((prev) => Object.assign({}, prev, { writeError: msg }))
          }
        }
        const allOk = ids.every((id) => states[id] === 'ok')
        setSt((prev) => {
          const batch = prev.batch || { order: ids, state: {}, results: {} }
          const nextState = Object.assign({}, batch.state)
          for (const id of ids) if (states[id]) nextState[id] = states[id]
          return Object.assign({}, prev, {
            stage: 'done', busy: false,
            batch: { running: false, order: ids, state: nextState, results: results },
          })
        })
        if (allOk && typeof props.onConfigured === 'function') {
          try { props.onConfigured() } catch (e) { /* 忽略：仅用于收起引导条 */ }
        }
      }

      useEffect(() => { boot() }, [])

      const byId = {}
      for (const raw of (Array.isArray(st.items) ? st.items : [])) { if (raw && raw.id) byId[raw.id] = raw }
      const rows = INIT_ORDER.map((id) => normalizeInitItem(byId[id] || null, id, t))
      const loading = Boolean(st.busy)
      const wsNone = st.workspaceSource === 'none'
      const form = st.form
      const wsFilled = String(form.workspace || '').trim().length > 0
      // 工作岗位域必填且不预选：它决定专家库的默认视角，缺省会落到产品默认值（对非该岗位的使用者是错的）
      const domainFilled = String(form.domain || '').length > 0
      const emptyList = st.stage === 'preview' && (!st.items || st.items.length === 0)
      const canCheck = !loading && wsFilled
      const canFinish = !loading && st.stage === 'preview' && !wsNone && domainFilled
      const batch = st.batch
      const writeDone = batch
        ? batch.order.filter((id) => batch.state[id] === 'ok' || batch.state[id] === 'fail').length
        : 0
      const writeAllOk = Boolean(batch) && batch.order.every((id) => batch.state[id] === 'ok')
      const progressText = batch ? fillAll(t('initRunProgress'), {
        done: Math.min(writeDone + (batch.running ? 1 : 0), batch.order.length || 1),
        total: batch.order.length || 1,
      }) : ''
      const sum = st.summary || {}
      const num = (v) => (typeof v === 'number' && isFinite(v)) ? String(v) : '—'
      const summaryText = fillAll(t('initSummary'), {
        total: num(sum.total === undefined ? rows.length : sum.total),
        toWrite: num(sum.toWrite === undefined ? 0 : sum.toWrite),
        upToDate: num(sum.upToDate === undefined ? 0 : sum.upToDate),
        blocked: num(sum.blocked === undefined ? 0 : sum.blocked),
      })
      const wsSourceText = st.workspaceSource === 'config'
        ? t('wsSourceConfig')
        : (st.workspaceSource === 'default' ? t('wsSourceDefault') : (wsNone ? t('wsSourceNone') : ''))
      const spinner = [h('span', {
        key: 'sp', className: 'wps-spin',
        style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }),
      }, '⟳'), t('initRecheck')]

      return h('div', null, [
        h('style', { key: 'kf' }, KEYFRAMES),
        h(Steps, { key: 'steps', t: t, current: 'init' }),
        h(WizSteps, { key: 'wiz', t: t, stage: st.stage }),

        // ── 段 1：填写配置 ──────────────────────────────────────────
        st.stage === 'form' ? h('div', { key: 'form', style: S.card }, [
          h('div', { key: 'head', style: S.cardHead }, [
            h('h3', { key: 'title', style: S.cardTitle }, [
              t('initFormTitle'),
              loading ? badge(t('initChecking'), S.badgeWarn) : null,
              st.workspace ? badge(t('workspaceLabel') + ' ' + st.workspace, S.badgeBrand) : null,
              wsNone ? badge(t('workspaceLabel') + ' ' + t('wsSourceNone'), S.badgeMissing) : null,
            ]),
            h('p', { key: 'sub', style: S.cardSub }, t('initFormHint')),
            h('div', { key: 'tools', style: S.toolbar }, [
              h('button', {
                key: 'recheck', type: 'button',
                disabled: loading,
                style: Object.assign({}, S.btn, loading ? S.btnDisabled : null),
                onClick: () => recheck(),
              }, loading ? spinner : t('initRecheck')),
            ]),
          ]),
          h('div', { key: 'body', style: S.cardBody }, [
            st.error ? h('div', { key: 'err', style: S.error }, [
              h('div', { key: 't', style: S.errorTitle }, t('initLoadFailed')),
              h('div', { key: 'm', style: S.errorMsg }, st.error),
              h('div', { key: 'h', style: S.errorHint }, t('initLoadFailedHint')),
              h('button', {
                key: 'b', type: 'button',
                style: Object.assign({}, S.btn, S.btnPrimary),
                onClick: () => boot(),
              }, t('retry')),
            ]) : null,
            wsNone ? h('div', { key: 'ws', style: S.warnLine }, t('workspaceNoneHint')) : null,
            st.pickError ? h('div', { key: 'pe', style: S.warnLine }, st.pickError) : null,
            h('div', { key: 'f1', style: S.field }, [
              h('label', { key: 'l', style: S.label }, [t('initFieldWorkspace'), h('span', { key: 'r', style: S.reqMark }, ' *')]),
              dirRow('workspace', form.workspace, 'C:/work/space'),
              h('div', { key: 'h', style: S.labelHint }, t('initFieldWorkspaceHint')),
              st.workspaceSource
                ? h('div', { key: 'src', style: wsNone ? S.warnLine : S.labelHint },
                    t(wsSourceNoteKey(st.workspaceSource)))
                : null,
              h('div', { key: 'cand', style: S.candRow }, [
                candidate('workspace', 'det', t('initCandDetectedWorkspace'), st.detected, Boolean(st.detected)),
              ]),
            ]),
            h('div', { key: 'f2', style: S.field }, [
              h('label', { key: 'l', style: S.label }, [t('initFieldDomain'), h('span', { key: 'r', style: S.reqMark }, ' *')]),
              h('select', {
                key: 's', style: S.select, value: form.domain,
                onChange: (e) => setField('domain', e && e.target ? e.target.value : ''),
              }, [h('option', { key: '__placeholder', value: '' }, t('initDomainPlaceholder'))]
                .concat(DOMAIN_OPTIONS.map((d) => h('option', { key: d[0], value: d[0] }, t(d[1]))))),
              h('div', { key: 'h', style: S.labelHint }, t('initFieldDomainHint')),
              domainFilled ? null : h('div', { key: 'w', style: S.warnLine }, t('initDomainRequired')),
            ]),
            h('div', { key: 'f3', style: S.fieldRow }, [
              h('div', { key: 'a', style: S.fieldCol }, h('div', { style: Object.assign({}, S.field, { marginBottom: 0 }) }, [
                h('label', { key: 'l', style: S.label }, [t('initFieldMemoryDir'), h('span', { key: 'o', style: S.labelHint }, ' (' + t('initOptional') + ')')]),
                dirRow('memoryDir', form.memoryDir, ''),
                h('div', { key: 'h', style: S.labelHint }, t('initFieldMemoryDirHint')),
                h('div', { key: 'cand', style: S.candRow }, [
                  candidate('memoryDir', 'def',
                    fill(t('initCandDefaultMemory'), st.libraryName || '…'),
                    (st.libraryName && st.memoryRoot) ? joinPath(st.memoryRoot, st.libraryName) : '',
                    Boolean(st.libraryName)),
                ]),
              ])),
              h('div', { key: 'b', style: S.fieldCol }, h('div', { style: Object.assign({}, S.field, { marginBottom: 0 }) }, [
                h('label', { key: 'l', style: S.label }, [t('initFieldObsidianDir'), h('span', { key: 'o', style: S.labelHint }, ' (' + t('initOptional') + ')')]),
                dirRow('obsidianSyncDir', form.obsidianSyncDir, ''),
                st.obsidianOff
                  ? h('div', { key: 'h', style: S.labelHintOn }, t('initObsidianOffNote'))
                  : h('div', { key: 'h', style: S.labelHint }, t('initFieldObsidianDirHint')),
                h('div', { key: 'cand', style: S.candRow }, [
                  candidate('obsidianSyncDir', 'off', t('initCandNoMirror'), '', true, st.obsidianOff, chooseNoMirror),
                  candidate('obsidianSyncDir', 'all', t('initCandMirrorAll'),
                    st.workspace ? joinPath(st.workspace, '00_全局记忆') : '', Boolean(st.workspace), false),
                  candidate('obsidianSyncDir', 'work', t('initCandMirrorWork'),
                    st.workspace ? joinPath(st.workspace, 'work-memory') : '', Boolean(st.workspace), false),
                ]),
              ])),
            ]),
            h('div', { key: 'f4', style: S.field }, [
              h('label', { key: 'l', style: S.label }, [t('initFieldExpert'), h('span', { key: 'o', style: S.labelHint }, ' (' + t('initOptional') + ')')]),
              h('input', {
                key: 'i', type: 'text', style: S.input, value: form.identityExpert,
                onChange: (e) => setField('identityExpert', e && e.target ? e.target.value : ''),
              }),
              h('div', { key: 'h', style: S.labelHint }, t('initFieldExpertHint')),
            ]),
          ]),
        ]) : null,

        // ── 段 2：检查与预览（写之前先给使用者看） ──────────────────
        st.stage === 'preview' ? h('div', { key: 'preview', style: S.card }, [
          h('div', { key: 'head', style: S.cardHead }, [
            h('h3', { key: 'title', style: S.cardTitle }, [
              t('initPlanTitle'),
              loading ? badge(t('initChecking'), S.badgeWarn) : null,
              wsNone
                ? badge(t('workspaceLabel') + ' ' + t('wsSourceNone'), S.badgeMissing)
                : badge(t('workspaceLabel') + ' ' + (st.workspace || form.workspace || '—'), S.badgeBrand),
            ]),
            h('p', { key: 'sub', style: S.cardSub }, t('initPlanHint')),
            h('div', { key: 'tools', style: S.toolbar }, [
              h('button', {
                key: 'recheck', type: 'button', disabled: loading,
                style: Object.assign({}, S.btn, loading ? S.btnDisabled : null),
                onClick: () => recheck(),
              }, loading ? spinner : t('initRecheck')),
            ]),
          ]),
          h('div', { key: 'body', style: S.cardBody }, [
            wsNone ? h('div', { key: 'ws', style: S.warnLine }, t('workspaceNoneHint')) : null,
            h('div', { key: 'list' }, rows.map((item) => h(InitRow, {
              key: item.id, t: t, item: item,
              open: st.open[item.id] === true, onToggle: toggleOpen,
            }))),
            emptyList ? h('div', { key: 'empty', style: S.note }, t('initEmpty')) : null,
          ]),
        ]) : null,

        // ── 段 3/4：执行与结果 ──────────────────────────────────────
        (st.stage === 'running' || st.stage === 'done') && batch ? h('div', { key: 'result', style: S.card }, [
          h('div', { key: 'head', style: S.cardHead }, h('h3', { key: 'title', style: S.cardTitle }, [
            (!batch.running && !writeAllOk) ? t('initWriteResult') : t('initDoneTitle'),
            batch.running
              ? badge(progressText, S.badgeWarn)
              : badge(writeAllOk ? t('installReportDone') : t('initDonePartial'), writeAllOk ? S.badgeOk : S.badgeMissing),
          ])),
          h('div', { key: 'body', style: S.cardBody }, [
            st.writeError ? h('div', { key: 'we', style: S.error }, [
              h('div', { key: 't', style: S.errorTitle }, t('initWriteFailTitle')),
              h('div', { key: 'm', style: S.errorMsg }, st.writeError),
              h('div', { key: 'h', style: S.errorHint }, t('initWriteFailHint')),
            ]) : null,
            h('div', { key: 'list' }, batch.order.map((id) => {
              const found = rows.filter((r) => r.id === id)[0]
              return h(InitResultRow, {
                key: id, t: t, item: found || { id: id, name: id },
                state: batch.state[id] || 'wait',
                panel: batch.results[id] || null,
              })
            })),
            !batch.running ? h('div', { key: 'done', style: S.note }, [
              h('div', { key: 'r', style: { fontWeight: 600, color: writeAllOk ? '#16794a' : '#b42318' } }, t('initDoneRestart')),
              h('div', { key: 'h', style: { marginTop: '4px' } }, t('initDoneHint')),
            ]) : null,
          ]),
        ]) : null,

        // ── 动作条与安全说明 ────────────────────────────────────────
        st.stage === 'form' ? h('div', { key: 'action', style: S.actionBar }, [
          h('button', {
            key: 'check', type: 'button',
            disabled: !canCheck,
            title: canCheck ? undefined : t('initFieldWorkspaceHint'),
            style: Object.assign({}, S.btn, S.btnPrimary, canCheck ? null : S.btnDisabled),
            onClick: () => checkPreview(),
          }, loading ? spinner : t('initCheckPreview')),
          h('span', { key: 'note', style: S.actionNote }, t('initLead')),
        ]) : null,
        st.stage === 'preview' ? h('div', { key: 'action', style: S.actionBar }, [
          h('button', {
            key: 'finish', type: 'button',
            disabled: !canFinish,
            title: canFinish ? undefined : (!domainFilled ? t('initDomainRequired') : t('workspaceNoneHint')),
            style: Object.assign({}, S.btn, S.btnPrimary, canFinish ? null : S.btnDisabled),
            onClick: () => finish(),
          }, loading ? spinner : t('initFinish')),
          h('button', {
            key: 'back', type: 'button', disabled: loading,
            style: Object.assign({}, S.btn, loading ? S.btnDisabled : null),
            onClick: () => setSt((prev) => Object.assign({}, prev, { stage: 'form', error: '' })),
          }, t('initBackToForm')),
          h('span', { key: 'note', style: S.actionNote }, domainFilled ? summaryText : t('initDomainRequired')),
        ]) : null,
        st.stage === 'done' ? h('div', { key: 'action', style: S.actionBar }, [
          h('button', {
            key: 'again', type: 'button', disabled: loading,
            style: Object.assign({}, S.btn, loading ? S.btnDisabled : null),
            onClick: () => recheck(),
          }, t('initRecheck')),
          h('span', { key: 'note', style: S.actionNote }, summaryText),
        ]) : null,

        h('div', { key: 'foot', style: S.note }, t('initSafety')),
      ])
    }

    // ══════════════════════════════════════════════════════════════
    // P4「能力配置」（tab id = config）：四组 —— 记忆库 / 专家库 /
    // 文档能力（自检状态）/ 桌面形象（状态 + 跳转）。
    //
    // 契约（17 号文档）：GET /settings 只读枚举（宿主按白名单裁剪到
    // work-memory + experts，fields 为 schema 归一化结果）；
    // POST /settings/write { ns, dryRun:false, revision, ops }，默认 dry-run，
    // revision 落后返回 409。ns 与 path 的白名单全在**宿主侧**硬编码，
    // 客户端只发键名与值 —— 不直写 settings.yaml，也不读写 workspace-tokenpet 的 localStorage。
    //
    // 降级纪律：服务不可用 / 子插件未安装 → 分组内给可读提示，页面照常渲染。
    // 冲突纪律：409 → 提示「设置已被其他改动更新」+ 自动重读，**草稿保留**（不丢输入）。
    // ══════════════════════════════════════════════════════════════

    /** 设置命名空间白名单（与宿主侧同一口径；客户端只用来决定渲染哪张卡片） */
    const CFG_NS_MEMORY = 'work-memory'
    const CFG_NS_EXPERTS = 'experts'
    const CFG_NS_LIST = [CFG_NS_MEMORY, CFG_NS_EXPERTS]
    /**
     * 草稿哨兵：该键「待清除用户层覆盖」。NUL 前缀保证与任何真实输入都不冲突；
     * 只活在客户端草稿里，上报时转成 ops 的 { op:'unset', path:[key] }。
     */
    const CFG_UNSET = '\u0000unset'
    /** 桌面形象（workspace-tokenpet）自己的设置分区 id —— 只作为跳转目标 */
    const CFG_PET_SECTION = 'workspace-tokenpet'
    /** 预览文本上限（与契约一致） */
    const CFG_PREVIEW_MAX = 2000
    /** 数值输入兜底上限（schema 只保证 natural，给 UI 一个防误触的边界） */
    const CFG_NUM_MAX = 1000000

    /**
     * 字段元数据：type 决定控件 —— bool 开关 / num 数字框 / slider 滑块 /
     * select 下拉 / str 文本框 / complex 只读。标签与说明走 locale 字典
     * （cfgF<Key> / cfgH<Key>，键名按 key 首字母大写拼接），接口给的
     * description 只作中文兜底；接口 fields[].type 只在本地没有元数据时才采信。
     */
    const CFG_FIELD_META = {
      // 记忆库 24 键
      personaLabel: { type: 'str' },
      injectMemory: { type: 'bool' },
      snapshotOrder: { type: 'num' },
      snapshotMaxChars: { type: 'num' },
      snapshotLimitGlobal: { type: 'num' },
      snapshotLimitUser: { type: 'num' },
      snapshotLimitProject: { type: 'num' },
      snapshotLimitDaily: { type: 'num' },
      archiveEnabled: { type: 'bool' },
      dailyRetentionDays: { type: 'num' },
      projectTtlDays: { type: 'num' },
      userTtlDays: { type: 'num' },
      triageEnabled: { type: 'bool' },
      triageGraceDays: { type: 'num' },
      triageAskInSnapshot: { type: 'bool' },
      backupEnabled: { type: 'bool' },
      backupDir: { type: 'str' },
      backupKeep: { type: 'num' },
      maintainWarnDays: { type: 'num' },
      globalWarnCount: { type: 'num' },
      reviewEnabled: { type: 'bool' },
      dailyAutoLog: { type: 'bool' },
      memoryDir: { type: 'str' },
      obsidianSyncDir: { type: 'str' },
      // 专家库（schema 全量；阈值三项带滑块）
      expertsEnabled: { type: 'bool' },
      injectOrder: { type: 'num' },
      defaultDomain: { type: 'select' },
      identityExpert: { type: 'str' },
      enabledDomains: { type: 'str' },
      enabledExperts: { type: 'str' },
      expertInjectMax: { type: 'slider', min: 1, max: 3, step: 1 },
      expertInjectDetail: {
        type: 'select',
        options: [['auto', 'cfgDetailAuto'], ['card', 'cfgDetailCard'], ['full', 'cfgDetailFull']],
      },
      expertInjectBudgetChars: { type: 'slider', min: 200, max: 4000, step: 100 },
      expertSecondThreshold: { type: 'slider', min: 0, max: 1, step: 0.05 },
      expertMinScore: { type: 'slider', min: 0, max: 1, step: 0.05 },
      expertShowBanner: { type: 'bool' },
      expertSetupDone: { type: 'bool' },
    }

    /** 记忆库 24 键的语义分组（顺序即展示顺序，与契约第三节一致） */
    const CFG_MEMORY_GROUPS = [
      {
        id: 'inject', titleKey: 'cfgMemGInject', hintKey: 'cfgMemGInjectHint',
        keys: ['personaLabel', 'injectMemory', 'snapshotOrder', 'snapshotMaxChars',
          'snapshotLimitGlobal', 'snapshotLimitUser', 'snapshotLimitProject', 'snapshotLimitDaily'],
      },
      {
        id: 'archive', titleKey: 'cfgMemGArchive', hintKey: 'cfgMemGArchiveHint',
        keys: ['archiveEnabled', 'dailyRetentionDays', 'projectTtlDays', 'userTtlDays'],
      },
      {
        id: 'triage', titleKey: 'cfgMemGTriage', hintKey: 'cfgMemGTriageHint',
        keys: ['triageEnabled', 'triageGraceDays', 'triageAskInSnapshot'],
      },
      {
        id: 'ops', titleKey: 'cfgMemGOps', hintKey: 'cfgMemGOpsHint',
        keys: ['backupEnabled', 'backupDir', 'backupKeep', 'maintainWarnDays', 'globalWarnCount',
          'reviewEnabled', 'dailyAutoLog'],
      },
      {
        id: 'dirs', titleKey: 'cfgMemGDirs', hintKey: 'cfgMemGDirsHint',
        keys: ['memoryDir', 'obsidianSyncDir'],
      },
    ]

    /** 专家库：范围与阈值两小节（阈值三项渲染成滑块） */
    const CFG_EXPERT_GROUPS = [
      {
        id: 'core', titleKey: 'cfgExpGCore', hintKey: 'cfgExpGCoreHint',
        keys: ['expertsEnabled', 'defaultDomain', 'identityExpert', 'enabledDomains',
          'enabledExperts', 'injectOrder', 'expertShowBanner', 'expertSetupDone'],
      },
      {
        id: 'threshold', titleKey: 'cfgExpGThreshold', hintKey: 'cfgExpGThresholdHint', slider: true,
        keys: ['expertInjectMax', 'expertInjectDetail', 'expertInjectBudgetChars',
          'expertSecondThreshold', 'expertMinScore'],
      },
    ]

    /** ns → 分组定义 / 卡片标题 / 卡片引言 */
    const CFG_GROUPS = { 'work-memory': CFG_MEMORY_GROUPS, experts: CFG_EXPERT_GROUPS }
    const CFG_NS_TITLE_KEY = { 'work-memory': 'cfgGroupMemory', experts: 'cfgGroupExperts' }

    /**
     * 能力配置页的**插件级标签**：一次只渲染当前插件的配置。
     * 原先四组从头到尾铺开（24 + 10 键），找某一项要滚很长（2026-09-13 使用者反馈）。
     * 标签文案复用各组既有标题 key，不新增文案。
     */
    const CFG_GROUP_TABS = [
      { id: 'work-memory', labelKey: 'cfgGroupMemory' },
      { id: 'experts', labelKey: 'cfgGroupExperts' },
      { id: 'docs', labelKey: 'cfgGroupDocs' },
      { id: 'pet', labelKey: 'cfgGroupPet' },
    ]
    const CFG_NS_LEAD_KEY = { 'work-memory': 'cfgMemoryLead', experts: 'cfgExpertsLead' }

    /** 文档模块的四个技能（静态清单：落盘状态由文档模块自检给出，本页不臆断） */
    const CFG_DOC_SKILLS = [
      ['office-word', 'cfgDocSkillWord'],
      ['office-excel', 'cfgDocSkillExcel'],
      ['office-ppt', 'cfgDocSkillPpt'],
      ['pdf-tools', 'cfgDocSkillPdf'],
    ]
    /** 文档依赖面板展示的三项（复用 /check 的 id 与既有 label 字典） */
    const CFG_DOC_DEPS = ['python', 'pythonDeps', 'wps']
    const CFG_DOC_DEP_LABEL_KEYS = { python: 'itemPython', pythonDeps: 'itemPythonDeps', wps: 'itemWps' }

    /** key → 字典键尾（cfgF / cfgH 后接首字母大写形式） */
    function cfgKeyTail(key) {
      const s = String(key === undefined || key === null ? '' : key)
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
    }

    /** 字段中文/英文标签（字典缺失时退回键名，绝不显示空白） */
    function cfgLabel(t, key) {
      const k = 'cfgF' + cfgKeyTail(key)
      const v = t(k)
      return v === k ? String(key) : v
    }

    /** 字段说明：字典优先；没有就回落到接口 description（可能是中文），再没有就不渲染 */
    function cfgHint(t, key, nsState) {
      const k = 'cfgH' + cfgKeyTail(key)
      const v = t(k)
      if (v !== k) return v
      const f = nsState && nsState.fields ? nsState.fields[key] : null
      const d = f && typeof f.description === 'string' ? f.description.trim() : ''
      return d
    }

    /** 把时间戳渲染成 HH:MM:SS（「最近读取」提示用；异常时留空，绝不因格式化崩页） */
    function cfgClock(ts) {
      try { return new Date(ts).toLocaleTimeString() } catch (err) { return '' }
    }

    /** 归一化一个命名空间（字段一律容错：接口给什么用什么，缺什么退什么） */
    function cfgNormalizeNs(raw) {
      const r = (raw && typeof raw === 'object') ? raw : {}
      const fields = Array.isArray(r.fields) ? r.fields : []
      const byKey = {}
      for (const f of fields) {
        if (f && typeof f.key === 'string' && f.key) byKey[f.key] = f
      }
      return {
        ns: String(r.ns || ''),
        title: typeof r.title === 'string' ? r.title : '',
        revision: (typeof r.revision === 'number' && isFinite(r.revision)) ? r.revision : null,
        writable: r.writable !== false,
        applies: typeof r.applies === 'string' ? r.applies : '',
        // 子插件未安装时宿主**不省略该 ns**，而是给占位条目（installed:false、fields 空）
        installed: r.installed !== false,
        value: (r.value && typeof r.value === 'object') ? r.value : {},
        user: (r.user && typeof r.user === 'object') ? r.user : {},
        fields: byKey,
      }
    }

    /**
     * 解析 GET /settings 响应：白名单内的 ns → map；顺带识别服务端降级。
     * 宿主在 ctx.settings 不可用 / describe 失败时返回**HTTP 200 + ok:false + namespaces**，
     * 这种「结构完整但已降级」不再整页报错，而是给顶部提示 + 各分组本身的降级文案。
     */
    function cfgParseView(body) {
      const list = Array.isArray(body && body.namespaces) ? body.namespaces : []
      const map = {}
      for (const item of list) {
        if (!item || CFG_NS_LIST.indexOf(String(item.ns)) < 0) continue
        map[item.ns] = cfgNormalizeNs(item)
      }
      const degraded = Boolean(body && body.ok === false)
      return {
        map: map,
        degraded: degraded,
        warn: degraded ? String(body.message || body.error || '') : '',
      }
    }

    /** 控件类型：本地元数据优先，其次接口 fields.type，最后按值猜 */
    function cfgFieldType(nsState, key, value) {
      const meta = CFG_FIELD_META[key]
      if (meta && meta.type) return meta.type
      const f = nsState && nsState.fields ? nsState.fields[key] : null
      const ft = f && typeof f.type === 'string' ? f.type.toLowerCase() : ''
      if (ft === 'boolean' || ft === 'bool') return 'bool'
      if (ft === 'number' || ft === 'natural' || ft === 'int' || ft === 'integer') return 'num'
      if (ft === 'complex' || ft === 'object' || ft === 'array') return 'complex'
      if (typeof value === 'boolean') return 'bool'
      if (typeof value === 'number') return 'num'
      return 'str'
    }

    /** 该字段的 schema 默认值（没有就返回 undefined） */
    function cfgFieldDefault(nsState, key) {
      const f = nsState && nsState.fields ? nsState.fields[key] : null
      if (f && f.default !== undefined) return f.default
      return undefined
    }

    /** 当前应显示的值：草稿 > 接口解析值 > 默认值 */
    function cfgDisplayValue(nsState, drafts, key) {
      if (drafts && drafts[key] !== undefined && drafts[key] !== CFG_UNSET) return drafts[key]
      const v = nsState && nsState.value ? nsState.value[key] : undefined
      if (v !== undefined) return v
      const d = cfgFieldDefault(nsState, key)
      return d === undefined ? '' : d
    }

    /** 宽松相等（数字与其字符串等价；布尔按字符串比）—— 只用于判断「有没有改动」 */
    function cfgSameValue(a, b) {
      if (a === b) return true
      if (a === undefined || a === null || b === undefined || b === null) return false
      return String(a) === String(b)
    }

    /** 该键是否有「待保存」的改动（unset 只对真的存在于用户层的键才算改动） */
    function cfgIsDirty(nsState, drafts, key) {
      if (!drafts || drafts[key] === undefined) return false
      const dv = drafts[key]
      if (dv === CFG_UNSET) return Boolean(nsState && nsState.user && nsState.user[key] !== undefined)
      const cur = nsState && nsState.value ? nsState.value[key] : undefined
      return !cfgSameValue(cur, dv)
    }

    /** 草稿 → ops（只发有变化的键；数值格式非法的键跳过并计数） */
    function cfgBuildOps(nsState, drafts) {
      const ops = []
      let skipped = 0
      const keys = Object.keys(drafts || {})
      for (const key of keys) {
        const dv = drafts[key]
        if (dv === CFG_UNSET) {
          if (nsState && nsState.user && nsState.user[key] !== undefined) ops.push({ op: 'unset', path: [key] })
          continue
        }
        const fieldInfo = nsState && nsState.fields ? nsState.fields[key] : null
        // 宿主标为不可写的键（复杂类型等）不下发，避免必然被拒的请求
        if (fieldInfo && fieldInfo.writable === false) continue
        const type = cfgFieldType(nsState, key, dv)
        if ((type === 'num' || type === 'slider') && (dv === '' || !isFinite(Number(dv)))) { skipped++; continue }
        const cur = nsState && nsState.value ? nsState.value[key] : undefined
        if (cfgSameValue(cur, dv)) continue
        ops.push({ op: 'set', path: [key], value: (type === 'num' || type === 'slider') ? Number(dv) : dv })
      }
      return { ops: ops, skipped: skipped }
    }

    /** 滑块/数字显示：小数步长保留两位，整数原样 */
    function cfgFormatValue(value, meta) {
      const step = meta && typeof meta.step === 'number' ? meta.step : 0
      const n = Number(value)
      if (value === '' || value === undefined || value === null || !isFinite(n)) {
        return value === undefined || value === null ? '' : String(value)
      }
      return step > 0 && step < 1 ? n.toFixed(2) : String(n)
    }

    /** 滑块值收敛到 [min, max]（避免外部脏值把 range 弄到非法区间） */
    function cfgClampNumber(value, meta) {
      const n = Number(value)
      const min = meta && typeof meta.min === 'number' ? meta.min : 0
      const max = meta && typeof meta.max === 'number' ? meta.max : CFG_NUM_MAX
      if (!isFinite(n)) return min
      if (n < min) return min
      if (n > max) return max
      return n
    }

    /**
     * 尽力打开宿主设置面板的指定分区。
     * 宿主没给编程入口（设置面板的 activeId 是外壳组件内部 state，只投影
     * settings.section 账本），所以按 DOM 约定尝试：
     *   ① 宿主将来若暴露 window.__DSH_OPEN_SETTINGS_SECTION__ 就直接用；
     *   ② 否则先点开设置触发器（button[aria-haspopup="dialog"]），
     *      再在 [role="dialog"] nav 里按分区名找到导航按钮并点它。
     * 返回 true = 已发出点击；false = 当前载体/宿主结构不支持（页面显示可读提示，不抛错）。
     */
    function openSettingsSection(id, names) {
      try {
        if (typeof window === 'undefined' || typeof document === 'undefined') return false
        const w = window
        if (typeof w.__DSH_OPEN_SETTINGS_SECTION__ === 'function') {
          w.__DSH_OPEN_SETTINGS_SECTION__(id)
          return true
        }
        const doc = document
        // 面板可能已经开着（使用者就是从设置里进来的）；没开就先点外壳的设置触发器。
        let dialog = doc.querySelector('[role="dialog"]')
        if (!dialog) {
          const trigger = doc.querySelector('button[aria-haspopup="dialog"]')
          if (!trigger || typeof trigger.click !== 'function') return false
          trigger.click()
          dialog = doc.querySelector('[role="dialog"]')
        }
        if (!dialog || typeof dialog.querySelectorAll !== 'function') return false
        const targets = (names && names.length ? names : [id]).map((x) => String(x).toLowerCase())
        // 左侧导航的容器**不一定是 <nav>**（真机上不是，原先只查 nav → 永远匹配不上），
        // 所以按「nav 优先 → 整个面板兜底」两轮找，并放宽可点元素种类。
        const scopes = []
        const nav = dialog.querySelector('nav')
        if (nav) scopes.push(nav)
        scopes.push(dialog)
        for (const scope of scopes) {
          const nodes = scope.querySelectorAll('button, [role="tab"], [role="button"], a')
          for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i]
            const txt = String(node.textContent || '').trim().toLowerCase()
            // 只认短标签：避免命中大段正文里恰好含关键词的节点
            if (!txt || txt.length > 40) continue
            for (const tgt of targets) {
              if (tgt && txt.indexOf(tgt) >= 0 && typeof node.click === 'function') {
                node.click()
                return true
              }
            }
          }
        }
        return false
      } catch (err) {
        return false
      }
    }

    /** 单个设置项：标签 + 已覆盖标记 + 控件 + 清除覆盖 / 恢复默认（无 hooks，纯 props） */
    function ConfigFieldRow(props) {
      const t = props.t
      const nsKey = props.nsKey
      const nsState = props.nsState
      const key = props.key
      const drafts = props.drafts
      const handlers = props.handlers
      const meta = CFG_FIELD_META[key] || {}
      const draft = drafts ? drafts[key] : undefined
      const rawValue = cfgDisplayValue(nsState, drafts, key)
      const type = cfgFieldType(nsState, key, rawValue)
      const overridden = Boolean(nsState.user && nsState.user[key] !== undefined)
      const pendingUnset = draft === CFG_UNSET
      const dirty = cfgIsDirty(nsState, drafts, key)
      const fieldInfo = nsState.fields ? nsState.fields[key] : null
      // 契约 §4.1：fields 是唯一真源，只渲染宿主实际返回的字段。
      // 键表里可能有宿主 schema 未声明的键（例：experts.injectOrder 只存在于部署层 base，
      // 不在 settings schema）——这类键渲染出来也是死字段，用户一改必被宿主 path 白名单 400 拒绝。
      if (!fieldInfo) return null
      // 复杂类型 / 宿主标为不可写的键：控件只读，且不给「清除覆盖 / 恢复默认」
      //（宿主对这类键会直接 400 拒绝，不如从 UI 上就不发）
      const fieldWritable = !(fieldInfo && fieldInfo.writable === false)
      const busy = handlers.busy === true || nsState.writable === false || !fieldWritable
      const def = cfgFieldDefault(nsState, key)
      const canRestore = def !== undefined && !cfgSameValue(rawValue, def)
      const hint = cfgHint(t, key, nsState)

      const common = { 'data-cfg-ns': nsKey, 'data-cfg-key': key }
      function inputProps(action) {
        return Object.assign({
          disabled: busy,
          'data-cfg-action': action,
          onChange: (e) => {
            const v = e && e.target ? e.target.value : ''
            // 数字框允许中间态（空串 / 半截数字）：非法值先原样留在草稿里，
            // 保存时由 cfgBuildOps 跳过并提示，不写坏设置。
            if (type === 'num') {
              if (v === '') return handlers.setDraft(nsKey, key, '')
              const n = Number(v)
              return handlers.setDraft(nsKey, key, isFinite(n) ? n : v)
            }
            return handlers.setDraft(nsKey, key, v)
          },
        }, common)
      }

      let control = null
      if (type === 'bool') {
        control = h('label', { key: 'w', style: S.cfgSwitch }, [
          h('input', Object.assign({
            key: 'i', type: 'checkbox', checked: rawValue === true, style: S.check,
            'data-cfg-action': 'toggle',
            onChange: (e) => handlers.setDraft(nsKey, key, Boolean(e && e.target && e.target.checked)),
          }, common)),
          h('span', { key: 'x' }, rawValue === true ? t('cfgOn') : t('cfgOff')),
        ])
      } else if (type === 'slider') {
        const min = typeof meta.min === 'number' ? meta.min : 0
        const max = typeof meta.max === 'number' ? meta.max : 1
        const step = typeof meta.step === 'number' ? meta.step : 0.05
        control = h('div', { key: 's', style: S.cfgSlider }, [
          h('input', Object.assign({
            key: 'i', type: 'range', min: min, max: max, step: step,
            value: cfgClampNumber(rawValue, meta), style: S.cfgRange,
            'data-cfg-action': 'slide',
            onChange: (e) => {
              const v = e && e.target ? e.target.value : min
              handlers.setDraft(nsKey, key, cfgClampNumber(v, meta))
            },
          }, common)),
          h('span', { key: 'v', style: S.cfgRangeValue }, cfgFormatValue(rawValue, meta)),
        ])
      } else if (type === 'select') {
        const value = rawValue === undefined || rawValue === null ? '' : String(rawValue)
        // 选项来源：字段自带 options（[值, 字典 key] 对）优先，否则回落到岗位域表
        const opts = Array.isArray(meta.options) && meta.options.length > 0 ? meta.options : DOMAIN_OPTIONS
        const known = opts.some((o) => o[0] === value)
        control = h('select', Object.assign({
          key: 's', style: S.select, value: value,
          'data-cfg-action': 'select',
          onChange: (e) => handlers.setDraft(nsKey, key, e && e.target ? e.target.value : ''),
        }, common), opts.map((o) => h('option', { key: o[0], value: o[0] }, t(o[1])))
          .concat(!known && value ? [h('option', { key: '__other', value: value }, value)] : []))
      } else if (type === 'complex') {
        // 复杂类型（契约：标记 type:"complex" 并降级只读）
        control = h('div', { key: 'c', style: S.itemValue }, String(JSON.stringify(rawValue === undefined ? null : rawValue)).slice(0, 200))
      } else {
        control = h('input', Object.assign({
          key: 'i', type: 'text', style: S.input,
          value: rawValue === undefined || rawValue === null ? '' : String(rawValue),
        }, inputProps('set')))
      }

      const actions = []
      actions.push(h('button', Object.assign({
        key: 'u', type: 'button', disabled: busy || !overridden,
        title: overridden ? t('cfgUnset') : t('cfgOverride'),
        style: Object.assign({}, S.btn, (busy || !overridden) ? S.btnDisabled : null),
        onClick: () => handlers.unsetKey(nsKey, key),
      }, common, { 'data-cfg-action': 'unset' }), t('cfgUnset')))
      actions.push(h('button', Object.assign({
        key: 'r', type: 'button', disabled: busy || !canRestore,
        style: Object.assign({}, S.btn, (busy || !canRestore) ? S.btnDisabled : null),
        onClick: () => handlers.restoreKey(nsKey, key),
      }, common, { 'data-cfg-action': 'restore' }), t('cfgRestore')))

      return h('div', Object.assign({ key: 'r-' + key, style: S.cfgRow }, common), [
        h('div', { key: 'l', style: S.cfgColLabel }, [
          h('div', { key: 'n', style: S.cfgLabelText }, [
            cfgLabel(t, key),
            overridden ? badge(t('cfgOverride'), S.badgeBrand) : null,
            pendingUnset ? badge(t('cfgOverridePending'), S.badgeWarn) : null,
            dirty && !pendingUnset ? h('span', { key: 'd', style: S.cfgDirty }, fill(t('cfgDirty'), 1)) : null,
          ]),
          hint ? h('div', { key: 'h', style: S.cfgHintText }, hint) : null,
        ]),
        h('div', { key: 'c', style: S.cfgColControl }, [control, h('div', { key: 'a', style: S.cfgRowActions }, actions)]),
      ])
    }

    /** 一个小节（标题 + 说明 + 若干设置项）；无可用行时返回 null（不产生空小节） */
    function cfgRenderSection(t, nsKey, nsState, drafts, def, handlers) {
      const rows = def.keys
        .map((key) => ConfigFieldRow({ t: t, nsKey: nsKey, nsState: nsState, drafts: drafts, key: key, handlers: handlers }))
        .filter(Boolean)
      if (!rows.length) return null
      // 注入 2–3 位专家会明显多占 TOKEN（契约第六节拍板时的已知代价）→ 就地在阈值组提示
      if (def.slider && Number(cfgDisplayValue(nsState, drafts, 'expertInjectMax')) > 1) {
        rows.push(h('div', { key: 'warn', style: S.warnLine }, t('cfgInjectMaxWarn')))
      }
      return h('div', { key: 'sec-' + def.id, style: S.cfgSection }, [
        h('div', { key: 't', style: S.cfgSectionTitle }, [
          t(def.titleKey),
          def.slider ? badge(t('cfgAppliedLive'), S.badgeOk) : null,
        ]),
        def.hintKey ? h('div', { key: 'h', style: S.cfgSectionHint }, t(def.hintKey)) : null,
        h('div', { key: 'b' }, rows),
      ])
    }

    /** 专家打分实时预览（只读；host 未装专家库时降级为可读提示） */
    function cfgRenderPreview(t, st, handlers) {
      const pv = st.preview || { phase: 'idle' }
      const data = pv.data || null
      const loading = pv.phase === 'loading'
      const text = String(st.previewText || '')
      const nodes = [
        h('div', { key: 'h', style: S.cfgPreviewHead }, t('cfgExpPreview')),
        h('div', { key: 'n', style: S.cfgSectionHint }, t('cfgExpPreviewHint')),
        h('div', { key: 'in', style: S.cfgPreviewInput }, [
          h('input', {
            key: 'i', type: 'text', style: S.input, value: text,
            placeholder: t('cfgExpPreviewPlaceholder'),
            'data-cfg-action': 'preview-text',
            onChange: (e) => handlers.setPreviewText(e && e.target ? e.target.value : ''),
          }),
          h('button', {
            key: 'b', type: 'button',
            disabled: loading || text.trim() === '',
            'data-cfg-action': 'preview',
            style: Object.assign({}, S.btn, S.btnPrimary, (loading || text.trim() === '') ? S.btnDisabled : null),
            onClick: () => handlers.preview(),
          }, loading
            ? [h('span', { key: 'sp', className: 'wps-spin', style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }) }, '⟳'), t('cfgExpPreviewRunning')]
            : t('cfgExpPreviewGo')),
        ]),
      ]
      if (text.length > CFG_PREVIEW_MAX) nodes.push(h('div', { key: 'tr', style: S.actionNote }, t('cfgExpPreviewTruncated')))
      if (pv.phase === 'idle') nodes.push(h('div', { key: 'e', style: S.actionNote }, t('cfgExpPreviewEmpty')))
      if (pv.phase === 'error') {
        nodes.push(h('div', { key: 'err', style: S.error }, [
          h('div', { key: 't', style: S.errorTitle }, t('cfgExpPreviewFailed')),
          h('div', { key: 'm', style: S.errorMsg }, String(pv.error || '')),
        ]))
      }
      if (data && (data.unavailable === true || data.ok === false)) {
        nodes.push(h('div', { key: 'na', style: S.note }, [
          h('div', { key: 'a' }, t('cfgExpPreviewUnavailable')),
          (data.message || data.error) ? h('div', { key: 'b', style: S.itemDetail }, String(data.message || data.error)) : null,
        ]))
      } else if (data) {
        const ranked = Array.isArray(data.ranked) ? data.ranked : []
        const selected = Array.isArray(data.selected) ? data.selected : []
        const conf = (data.config && typeof data.config === 'object') ? data.config : null
        nodes.push(h('div', { key: 'res' }, [
          h('div', { key: 'why', style: S.itemDetail }, t('cfgExpPreviewReason') + '：' + String(data.reason === undefined || data.reason === null ? '—' : data.reason)),
          h('div', { key: 'sel' }, [
            h('div', { key: 'l', style: S.outLabel }, t('cfgExpPreviewSelected')),
            selected.length
              ? h('div', { key: 'c', style: S.cfgChips }, selected.map((id, i) => badge(String(id), S.badgeOk)))
              : h('div', { key: 'n', style: S.itemDetail }, t('cfgExpPreviewNone')),
          ]),
          ranked.length ? h('div', { key: 'tb' }, h('table', { style: S.table }, [
            h('thead', { key: 'h' }, h('tr', null, [
              h('th', { key: '1', style: S.cfgTh }, t('cfgExpPreviewColId')),
              h('th', { key: '2', style: S.cfgTh }, t('cfgExpPreviewColDomain')),
              h('th', { key: '3', style: S.cfgTh }, t('cfgExpPreviewColScore')),
              h('th', { key: '4', style: S.cfgTh }, t('cfgExpPreviewColEvidence')),
              h('th', { key: '5', style: S.cfgTh }, t('cfgExpPreviewColWhy')),
            ])),
            h('tbody', { key: 'b' }, ranked.map((row, i) => {
              const r = row && typeof row === 'object' ? row : {}
              const reasons = Array.isArray(r.reasons) ? r.reasons.join(t('listSep')) : String(r.reasons === undefined ? '' : r.reasons)
              return h('tr', { key: String(r.id || i) }, [
                h('td', { key: 'a', style: S.cfgTd }, h('code', { style: S.mono }, String(r.id === undefined ? '—' : r.id))),
                h('td', { key: 'b', style: S.cfgTd }, String(r.domain === undefined ? '—' : r.domain)),
                h('td', { key: 'c', style: S.cfgTd }, String(r.score === undefined ? '—' : r.score)),
                h('td', { key: 'd', style: S.cfgTd }, String(r.evidence === undefined ? '—' : r.evidence)),
                h('td', { key: 'e', style: S.cfgTd }, reasons || '—'),
              ])
            })),
          ])) : null,
          conf ? h('div', { key: 'cf', style: S.actionNote }, t('cfgExpPreviewConfig') + '：'
            + 'expertInjectMax=' + String(conf.expertInjectMax) + ' · '
            + 'expertSecondThreshold=' + String(conf.expertSecondThreshold) + ' · '
            + 'expertMinScore=' + String(conf.expertMinScore)) : null,
        ]))
      }
      return h('div', { key: 'pv', style: S.cfgPreviewBox }, nodes)
    }

    /**
     * 「文档能力」状态面板（契约决定：dsh-doc-suite 零设置项 → 不做设置分组）。
     * 依赖状态复用「安装与检查」页的 GET /check（Python / Python 依赖 / WPS，只读）；
     * 四技能落盘状态由文档模块的自检命令给出，本页只列清单 —— 拿不到数据时
     * 也照样渲染静态说明，绝不出现空分组。
     */
    function DocPanel(props) {
      const t = props.t
      const state = useState({ phase: 'loading', error: '', items: null })
      const st = state[0]
      const setSt = state[1]
      useEffect(() => {
        let alive = true
        async function probe() {
          try {
            if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
            const body = await getJson('/check', 15000)
            if (!alive) return
            if (!body || typeof body !== 'object' || body.ok === false) throw new Error(String((body && body.error) || 'check 返回 ok:false'))
            setSt({ phase: 'ready', error: '', items: Array.isArray(body.items) ? body.items : [] })
          } catch (err) {
            if (!alive) return
            setSt({ phase: 'error', error: String((err && err.message) || err), items: null })
          }
        }
        probe()
        return () => { alive = false }
      }, [])
      const byId = {}
      if (Array.isArray(st.items)) for (const it of st.items) if (it && typeof it.id === 'string') byId[it.id] = it
      return h('div', { key: 'docs', style: S.card }, [
        h('div', { key: 'h', style: S.cardHead }, [
          h('h3', { key: 't', style: S.cardTitle }, [
            t('cfgGroupDocs'),
            badge('dsh-doc-suite'),
            st.phase === 'loading' ? badge(t('checking'), S.badgeWarn) : null,
          ]),
          h('p', { key: 's', style: S.cardSub }, t('cfgDocLead')),
        ]),
        h('div', { key: 'b', style: S.cardBody }, [
          st.phase === 'error' ? h('div', { key: 'err', style: S.error }, [
            h('div', { key: 't', style: S.errorTitle }, t('cfgDocCheckFailed')),
            h('div', { key: 'm', style: S.errorMsg }, st.error),
            h('div', { key: 'h', style: S.errorHint }, t('cfgDocCheckHint')),
          ]) : null,
          h('div', { key: 'dep', style: S.cfgSection }, [
            h('div', { key: 't', style: S.cfgSectionTitle }, [
              t('cfgDocDeps'),
              st.phase === 'ready' ? badge(t('cfgAppliedLive'), S.badgeOk) : null,
            ]),
            h('div', { key: 'h', style: S.cfgSectionHint }, t('cfgDocDepsHint')),
            st.phase === 'ready' ? h('table', { key: 'tb', style: S.table }, [
              h('thead', { key: 'h' }, h('tr', null, [
                h('th', { key: '1', style: S.cfgTh }, t('cfgColComponent')),
                h('th', { key: '2', style: S.cfgTh }, t('cfgColState')),
                h('th', { key: '3', style: S.cfgTh }, t('cfgColEvidence')),
              ])),
              h('tbody', { key: 'b' }, CFG_DOC_DEPS.map((id) => {
                const it = byId[id] || null
                const status = it && typeof it.status === 'string' ? it.status : 'unknown'
                return h('tr', { key: id }, [
                  h('td', { key: 'a', style: S.cfgTd }, t(CFG_DOC_DEP_LABEL_KEYS[id] || id)),
                  h('td', { key: 'b', style: S.cfgTd }, h('span', { style: Object.assign({}, S.badge, statusStyle(status)) }, statusLabel(t, status))),
                  h('td', { key: 'c', style: S.cfgTd }, String((it && it.value) || '—')),
                ])
              })),
            ]) : null,
          ]),
          h('div', { key: 'sk', style: S.cfgSection }, [
            h('div', { key: 't', style: S.cfgSectionTitle }, t('cfgDocSkills')),
            h('div', { key: 'h', style: S.cfgSectionHint }, t('cfgDocSkillHint')),
            h('div', { key: 'l', style: S.cfgChips }, CFG_DOC_SKILLS.map((s) =>
              h('span', { key: s[0], style: Object.assign({}, S.badge, S.badgeSkip) }, t(s[1]) + ' · ' + t('cfgDocSkillUnknown')))),
          ]),
          h('div', { key: 'note', style: S.note }, t('cfgDocDoctor')),
        ]),
      ])
    }

    /**
     * 「桌面形象」状态 + 跳转面板。契约决定：不实现 localStorage 读写桥，
     * 只显示安装状态（复用 GET /plugins）并把使用者送到 workspace-tokenpet 自己的面板。
     */
    function PetPanel(props) {
      const t = props.t
      const state = useState({ phase: 'loading', error: '', item: null, jumpFailed: false })
      const st = state[0]
      const setSt = state[1]
      useEffect(() => {
        let alive = true
        async function probe() {
          try {
            if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
            const body = await getJson('/plugins', 15000)
            if (!alive) return
            if (!body || typeof body !== 'object' || body.ok === false) throw new Error(String((body && body.error) || 'plugins 返回 ok:false'))
            const list = Array.isArray(body.plugins) ? body.plugins : (Array.isArray(body.items) ? body.items : [])
            let found = null
            for (const it of list) {
              if (it && String(it.id || it.name || '') === 'workspace-tokenpet') { found = it; break }
            }
            setSt({ phase: 'ready', error: '', item: found, jumpFailed: false })
          } catch (err) {
            if (!alive) return
            setSt({ phase: 'error', error: String((err && err.message) || err), item: null, jumpFailed: false })
          }
        }
        probe()
        return () => { alive = false }
      }, [])

      const installed = st.phase === 'ready' && Boolean(st.item) && st.item.installed !== false
      const version = st.item ? firstText(st.item.installedVersion, st.item.version) : ''
      const statusText = st.phase === 'loading'
        ? t('pluginsLoading')
        : (st.phase === 'error' ? t('cfgPetCheckFailed') : (installed ? t('plugStatusUpToDate') : t('notInstalled')))

      return h('div', { key: 'pet', style: S.card }, [
        h('div', { key: 'h', style: S.cardHead }, [
          h('h3', { key: 't', style: S.cardTitle }, [
            t('cfgGroupPet'),
            badge('workspace-tokenpet'),
            h('span', { style: Object.assign({}, S.badge, installed ? S.badgeOk : S.badgeSkip) }, statusText),
            version ? badge(version, S.badgeBrand) : null,
          ]),
          h('p', { key: 's', style: S.cardSub }, t('cfgPetLead')),
        ]),
        h('div', { key: 'b', style: S.cardBody }, [
          h('div', { key: 'row', style: S.toolbar }, [
            h('button', {
              key: 'go', type: 'button',
              'data-cfg-action': 'open-pet',
              style: Object.assign({}, S.btn, S.btnPrimary),
              onClick: () => {
                // 左侧导航里 workspace-tokenpet 那一项由它自己渲染，且**不本地化**：
          // 中英文界面下实测都显示「用量小宠物」（2026-09-13 两次验证）。
          // 我们这边叫「桌面形象」只是集成体自己的组名，不是宿主 UI 里的分区名，切勿再拿来匹配。
          // 候选只保留实测名 + ns id（后者是万一将来外壳改用 id 渲染导航的兜底）。
          const names = ['用量小宠物', CFG_PET_SECTION]
                let ok = false
                try {
                  ok = typeof props.openSection === 'function' ? props.openSection(CFG_PET_SECTION, names) === true : false
                } catch (err) {
                  ok = false
                }
                setSt((prev) => Object.assign({}, prev, { jumpFailed: !ok }))
              },
            }, t('cfgPetOpen')),
            h('span', { key: 'n', style: S.actionNote }, t('cfgPetLocalNote')),
          ]),
          st.jumpFailed ? h('div', { key: 'na', style: S.warnLine }, t('cfgPetOpenFailed')) : null,
          st.phase === 'error' ? h('div', { key: 'err', style: S.note }, [
            h('div', { key: 'a' }, t('cfgPetCheckFailed')),
            h('div', { key: 'b', style: S.itemDetail }, t('cfgPetCheckHint')),
          ]) : null,
        ]),
      ])
    }

    /**
     * 能力配置页（P4）。
     * - 数据：GET /settings（只读枚举，白名单裁剪）
     * - 写入：POST /settings/write（**恒带 dryRun:false** + revision 栅栏）
     * - 编辑模型：输入先进本地草稿（draft），点「保存改动」提交；
     *   「清除覆盖」（unset）与「恢复默认」（set 默认值）是单键即时提交。
     * - 409：提示「设置已被其他改动更新」+ 自动重读，草稿原样保留（不丢输入）。
     * - 降级：接口不可用 / ns 缺失 → 卡片内可读提示；文档/桌面各有独立数据源。
     */
    function ConfigPage(props) {
      const t = props.t
      const state = useState({
        phase: 'loading', error: '', namespaces: {}, drafts: {},
        busyNs: '', notice: '', noticeKind: '',
        // 当前显示的插件标签（默认记忆库）：切换只改渲染，不影响任何已加载数据。
        activeGroup: 'work-memory',
        // 最近一次成功读取的时刻：重读若数据没变，界面本来毫无动静，
        // 使用者会以为按钮坏了（2026-09-13 真机反馈）→ 用时间戳给出可见反馈。
        lastLoadedAt: 0,
        previewText: '', preview: { phase: 'idle', error: '', data: null },
      })
      const st = state[0]
      const setSt = state[1]

      useEffect(() => {
        let alive = true
        async function boot() {
          try {
            if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
            const res = await requestJsonFull('/settings', { headers: { accept: 'application/json' } }, 15000)
            if (!alive) return
            const body = res.body
            if (res.ok !== true || !body || typeof body !== 'object') {
              throw new Error(String((body && (body.error || body.message)) || ('HTTP ' + res.status)))
            }
            // ok:false 且连 namespaces 都没有（路由未注册 / 参数错误）才当整页失败
            if (body.ok === false && !Array.isArray(body.namespaces)) {
              throw new Error(String(body.message || body.error || 'settings 返回 ok:false'))
            }
            const view = cfgParseView(body)
            setSt((prev) => Object.assign({}, prev, {
              phase: 'ready', error: '', namespaces: view.map,
              notice: view.warn || prev.notice,
              noticeKind: view.warn ? 'warn' : prev.noticeKind,
              // 首次加载也算一次「读取」：进页面就能看到数据新鲜度（与手动重读一致）。
              lastLoadedAt: Date.now(),
            }))
          } catch (err) {
            if (!alive) return
            setSt((prev) => Object.assign({}, prev, { phase: 'error', error: String((err && err.message) || err) }))
          }
        }
        boot()
        return () => { alive = false }
      }, [])

      /**
       * 重读设置。keepDrafts=true 时**保留本地草稿**（409 冲突、手动刷新都走这条），
       * 这样自动重读不会冲掉使用者正在输入的值。
       */
      async function load(keepDrafts) {
        // 进入 loading：按钮显示「读取中…」+ 转圈，让重读**看得见**。
        setSt((prev) => Object.assign({}, prev, { phase: 'loading', busyNs: '', error: '' }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const res = await requestJsonFull('/settings', { headers: { accept: 'application/json' } }, 15000)
          const body = res.body
          if (res.ok !== true || !body || typeof body !== 'object') {
            throw new Error(String((body && (body.error || body.message)) || ('HTTP ' + res.status)))
          }
          if (body.ok === false && !Array.isArray(body.namespaces)) {
            throw new Error(String(body.message || body.error || 'settings 返回 ok:false'))
          }
          const view = cfgParseView(body)
          setSt((prev) => Object.assign({}, prev, {
            phase: 'ready', error: '', namespaces: view.map,
            notice: view.warn || prev.notice,
            noticeKind: view.warn ? 'warn' : prev.noticeKind,
            lastLoadedAt: Date.now(),
            drafts: keepDrafts ? prev.drafts : {},
          }))
          return true
        } catch (err) {
          // 重读失败**不该**把整页打成错误态：已加载的数据仍可用，用提示条告知即可。
          setSt((prev) => Object.assign({}, prev, {
            phase: Object.keys(prev.namespaces || {}).length ? 'ready' : 'error',
            notice: t('cfgReloadFailed') + '：' + String((err && err.message) || err),
            noticeKind: 'warn',
          }))
          return false
        }
      }

      /** 写入草稿：收集该 ns 有变化的 ops，一次 POST /settings/write */
      function setDraft(ns, key, value) {
        setSt((prev) => {
          const drafts = Object.assign({}, prev.drafts)
          const nsDrafts = Object.assign({}, drafts[ns] || {})
          nsDrafts[key] = value
          drafts[ns] = nsDrafts
          return Object.assign({}, prev, { drafts: drafts, notice: '', noticeKind: '' })
        })
      }

      /**
       * 真写：POST /settings/write，body 恒带 dryRun:false（契约第四节：不带就只试运行）。
       * 409 = 别人先改了 → 提示 + 自动重读（草稿保留）。
       * 成功 → 用响应回填 value/user/revision，并**只清掉本次提交的键**（其它草稿不动）。
       */
      async function write(ns, ops, skipped) {
        const nsState = st.namespaces[ns]
        if (!nsState) return
        if (nsState.writable === false) {
          setSt((prev) => Object.assign({}, prev, { notice: t('cfgWritableNo'), noticeKind: 'warn' }))
          return
        }
        setSt((prev) => Object.assign({}, prev, { busyNs: ns, notice: '', noticeKind: '' }))
        let res = null
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const payload = { ns: ns, dryRun: false, ops: ops }
          // revision 只在确实是整数时下发（宿主对非整数按「不带栅栏」处理）
          if (typeof nsState.revision === 'number' && isFinite(nsState.revision)) payload.revision = nsState.revision
          res = await requestJsonFull('/settings/write', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(payload),
          }, 30000)
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, {
            busyNs: '', notice: t('cfgSaveFailed') + '：' + String((err && err.message) || err), noticeKind: 'warn',
          }))
          return
        }
        if (res.status === 409) {
          setSt((prev) => Object.assign({}, prev, { busyNs: '', notice: t('cfgConflict'), noticeKind: 'warn' }))
          await load(true)
          return
        }
        const body = res.body || {}
        if (res.ok !== true || body.ok === false) {
          setSt((prev) => Object.assign({}, prev, {
            busyNs: '',
            notice: t('cfgSaveFailed') + '：' + String(body.error || body.message || ('HTTP ' + res.status)),
            noticeKind: 'warn',
          }))
          return
        }
        // 防御：宿主忽略 dryRun:false 时绝不能显示「已保存」（草稿保留，让使用者重试）
        if (body.dryRun === true) {
          setSt((prev) => Object.assign({}, prev, { busyNs: '', notice: t('cfgSaveDryRun'), noticeKind: 'warn' }))
          return
        }
        setSt((prev) => {
          const namespaces = Object.assign({}, prev.namespaces)
          const cur = namespaces[ns] || {}
          const next = Object.assign({}, cur)
          if (body.value && typeof body.value === 'object') next.value = body.value
          if (body.user && typeof body.user === 'object') next.user = body.user
          if (typeof body.revision === 'number' && isFinite(body.revision)) next.revision = body.revision
          namespaces[ns] = next
          const drafts = Object.assign({}, prev.drafts)
          const nsDrafts = Object.assign({}, drafts[ns] || {})
          for (const op of (ops || [])) {
            const path = op && Array.isArray(op.path) ? op.path : []
            if (path.length) delete nsDrafts[path[0]]
          }
          drafts[ns] = nsDrafts
          const extra = skipped ? (' · ' + fill(t('cfgSkipped'), skipped)) : ''
          return Object.assign({}, prev, {
            busyNs: '', namespaces: namespaces, drafts: drafts,
            notice: t('cfgSaved') + extra, noticeKind: 'ok',
          })
        })
      }

      /** 「保存改动」：把该 ns 草稿里所有有变化的键合成一次写入 */
      function saveNs(ns) {
        const nsState = st.namespaces[ns]
        if (!nsState) return
        const built = cfgBuildOps(nsState, st.drafts[ns] || {})
        if (!built.ops.length) {
          setSt((prev) => Object.assign({}, prev, {
            notice: built.skipped ? fill(t('cfgSkipped'), built.skipped) : t('cfgNoChange'),
            noticeKind: 'warn',
          }))
          return
        }
        write(ns, built.ops, built.skipped)
      }

      /** 「清除覆盖」：单键 unset（回到 base / 默认），即时提交 */
      function unsetKey(ns, key) {
        write(ns, [{ op: 'unset', path: [key] }], 0)
      }

      /** 「恢复默认」：把该键写回 schema 默认值，即时提交 */
      function restoreKey(ns, key) {
        const def = cfgFieldDefault(st.namespaces[ns], key)
        if (def === undefined) return
        write(ns, [{ op: 'set', path: [key], value: def }], 0)
      }

      /** 专家打分预览：GET /experts/preview?text=…（只读；文本截到 2000 字符） */
      async function runPreview() {
        const raw = String(st.previewText || '')
        const text = raw.slice(0, CFG_PREVIEW_MAX)
        if (!text.trim()) return
        setSt((prev) => Object.assign({}, prev, { preview: { phase: 'loading', error: '', data: null } }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const res = await requestJsonFull('/experts/preview?text=' + encodeURIComponent(text), { headers: { accept: 'application/json' } }, 15000)
          const body = res.body
          if (res.ok !== true || !body || typeof body !== 'object') {
            throw new Error(String((body && (body.error || body.message)) || ('HTTP ' + res.status)))
          }
          setSt((prev) => Object.assign({}, prev, { preview: { phase: 'ready', error: '', data: body } }))
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, {
            preview: { phase: 'error', error: String((err && err.message) || err), data: null },
          }))
        }
      }

      const handlers = {
        busy: Boolean(st.busyNs),
        setDraft: setDraft,
        unsetKey: unsetKey,
        restoreKey: restoreKey,
        saveNs: saveNs,
        preview: runPreview,
        setPreviewText: (v) => setSt((prev) => Object.assign({}, prev, { previewText: String(v === undefined || v === null ? '' : v) })),
      }
      const loading = st.phase === 'loading'

      /** 一个命名空间卡片：标题 + 引言 + 语义小节（+ 专家库的预览区） */
      function renderNsCard(nsKey, extraNodes) {
        const nsState = st.namespaces[nsKey] || null
        const drafts = st.drafts[nsKey] || {}
        const groups = CFG_GROUPS[nsKey] || []
        const known = {}
        for (const def of groups) for (const k of def.keys) known[k] = true
        const nodes = []
        // 不可用有两种形态：① 响应里根本没有该 ns；② 宿主给的占位条目 installed:false
        // （子插件未安装时宿主不省略 ns，而是给 fields/value 全空的占位）。
        const unavailable = !nsState || nsState.installed === false
          || (Object.keys(nsState.fields).length === 0 && Object.keys(nsState.value).length === 0)
        if (unavailable) {
          // 可读降级提示，不是空白分组
          nodes.push(h('div', { key: 'na', style: S.note }, t('cfgNsUnavailable')))
        } else {
          const dirtyCount = Object.keys(drafts).filter((k) => cfgIsDirty(nsState, drafts, k)).length
          for (const def of groups) {
            const sec = cfgRenderSection(t, nsKey, nsState, drafts, def, handlers)
            if (sec) nodes.push(sec)
          }
          // 接口多出来的键（后续版本新增）单独成组，保证「看得见」而不是被静默吞掉
          const extra = []
          const seen = {}
          const candidates = Object.keys(nsState.fields).concat(Object.keys(nsState.value))
          for (const k of candidates) {
            if (!k || known[k] || seen[k]) continue
            seen[k] = true
            if (CFG_FIELD_META[k]) continue
            extra.push(k)
          }
          if (extra.length) {
            nodes.push(cfgRenderSection(t, nsKey, nsState, drafts, { id: 'other', titleKey: 'cfgGroupOther', keys: extra }, handlers))
          }
          nodes.push(h('div', { key: 'save', style: S.cfgSaveBar }, [
            h('button', {
              key: 'b', type: 'button', disabled: st.busyNs === nsKey || dirtyCount === 0,
              'data-cfg-action': 'save', 'data-cfg-ns': nsKey,
              style: Object.assign({}, S.btn, S.btnPrimary, (st.busyNs === nsKey || dirtyCount === 0) ? S.btnDisabled : null),
              onClick: () => saveNs(nsKey),
            }, fill(t('cfgSaveDraft'), dirtyCount)),
            h('span', { key: 'n', style: S.actionNote }, st.busyNs === nsKey ? t('cfgLoading') : (dirtyCount ? fill(t('cfgDirty'), dirtyCount) : t('cfgAppliedLive'))),
            nsState.revision !== null ? h('span', { key: 'r', style: S.actionNote }, fill(t('cfgRevision'), nsState.revision)) : null,
          ]))
        }
        return h('div', { key: 'ns-' + nsKey, style: S.card }, [
          h('div', { key: 'h', style: S.cardHead }, [
            h('h3', { key: 't', style: S.cardTitle }, [
              t(CFG_NS_TITLE_KEY[nsKey] || nsKey),
              badge(nsKey, S.badgeBrand),
              nsState && nsState.writable === false ? badge(t('cfgWritableNo'), S.badgeWarn) : null,
              nsState && nsState.applies ? badge(nsState.applies) : null,
            ]),
            h('p', { key: 's', style: S.cardSub }, t(CFG_NS_LEAD_KEY[nsKey] || '')),
          ]),
          h('div', { key: 'b', style: S.cardBody }, nodes.concat(extraNodes || [])),
        ])
      }

      return h('div', { key: 'config' }, [
        h('style', { key: 'kf' }, KEYFRAMES),
        h('div', { key: 'head', style: S.cfgHead }, [
          h('div', { key: 'tx', style: S.cfgLead }, t('cfgLead')),
          h('div', { key: 'act', style: S.toolbar }, [
            h('button', {
              key: 'r', type: 'button', disabled: loading,
              'data-cfg-action': 'reload',
              style: Object.assign({}, S.btn, loading ? S.btnDisabled : null),
              onClick: () => load(true),
            }, loading
              ? [h('span', { key: 'sp', className: 'wps-spin', style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }) }, '⟳'), t('cfgLoading')]
              : t('cfgReload')),
            st.lastLoadedAt ? h('span', { key: 'at', style: S.actionNote }, t('cfgLastRead') + ' ' + cfgClock(st.lastLoadedAt)) : null,
          ]),
        ]),
        st.notice ? h('div', {
          key: 'notice',
          style: st.noticeKind === 'ok' ? S.cfgNoticeOk : S.cfgNoticeWarn,
        }, st.notice) : null,
        st.phase === 'error' ? h('div', { key: 'err', style: S.error }, [
          h('div', { key: 't', style: S.errorTitle }, t('cfgLoadFailed')),
          h('div', { key: 'm', style: S.errorMsg }, st.error),
          h('div', { key: 'h', style: S.errorHint }, t('cfgLoadFailedHint')),
          h('button', {
            key: 'b', type: 'button',
            style: Object.assign({}, S.btn, S.btnPrimary),
            onClick: () => load(true),
          }, t('cfgRetry')),
        ]) : null,
        h('div', { key: 'gtabs', style: S.cfgGroupTabs }, CFG_GROUP_TABS.map((tb) =>
          h('button', {
            key: tb.id, type: 'button',
            'data-cfg-action': 'switch-group',
            'data-cfg-group': tb.id,
            'aria-selected': st.activeGroup === tb.id,
            style: S.cfgGroupTab(st.activeGroup === tb.id),
            onClick: () => setSt((prev) => Object.assign({}, prev, { activeGroup: tb.id })),
          }, t(tb.labelKey)))),
        st.activeGroup === 'work-memory' ? renderNsCard(CFG_NS_MEMORY, null) : null,
        st.activeGroup === 'experts' ? renderNsCard(CFG_NS_EXPERTS, [cfgRenderPreview(t, st, handlers)]) : null,
        st.activeGroup === 'docs' ? h(DocPanel, { key: 'docs', t: t }) : null,
        st.activeGroup === 'pet' ? h(PetPanel, { key: 'pet', t: t, openSection: props.openSection }) : null,
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
      const first = ['install', 'plugins', 'init', 'config', 'about'].indexOf(props.initialTab) >= 0 ? props.initialTab : 'about'
      const state = useState(first)
      const tab = state[0]
      const setTab = state[1]
      // P3 首用引导：只在**未显式指定页签**时探测 setupNeeded（显式深链/冒烟不额外发请求）；
      // setupNeeded 缺失按 false 处理（向后兼容），为 true 时默认落到「初始化」页。
      const setup = useState({ needed: false, count: 0 })
      const setupSt = setup[0]
      const setSetup = setup[1]
      useEffect(() => {
        if (props.initialTab) return
        if (typeof fetch !== 'function') return
        let alive = true
        getJson('/basedeck', 15000).then((body) => {
          if (!alive || !body || typeof body !== 'object' || body.ok === false) return
          if (body.setupNeeded !== true) return
          setSetup({ needed: true, count: setupCount(body) })
          setTab('init')
        }).catch(() => { /* 探测失败不打扰：默认页保持原样 */ })
        return () => { alive = false }
      }, [])
      let page = null
      if (tab === 'install') page = h(InstallPage, { key: 'i', t: t })
      else if (tab === 'plugins') page = h(PluginsPage, { key: 'g', t: t })
      else if (tab === 'init') page = h(InitPage, {
        key: 'n', t: t,
        pickDirectory: props.pickDirectory,
        onConfigured: () => setSetup({ needed: false, count: 0 }),
      })
      else if (tab === 'config') page = h(ConfigPage, { key: 'c', t: t, openSection: props.openSection })
      else page = h(AboutPage, { key: 'a', t: t })
      return h('div', { style: S.wrap }, [
        h('h1', { key: 'h', style: S.h1 }, t('title')),
        h('p', { key: 'l', style: S.lead }, t('lead')),
        h(StatusBar, { key: 'b', t: t }),
        setupSt.needed ? h('div', { key: 'setup', style: S.setupBar }, [
          h('span', { key: 'x', style: S.setupText }, fill(t('setupNeeded'), setupSt.count)),
          h('button', {
            key: 'go', type: 'button',
            style: Object.assign({}, S.btn, S.btnPrimary),
            onClick: () => setTab('init'),
          }, t('setupGo')),
        ]) : null,
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

      // 目录选择入口（按环境择优，入口在**每次点击时**重新解析）：
      // ① 桌面壳（Windows）把原生选择器发布在 window.__DSH_DESKTOP_PICK_DIRECTORY__ 上：
      //    () => Promise<string|null>（取消为 null）；出处 dsh-plugin-desktop 的
      //    installDesktopDirectoryPickerBridge —— 注释原文「Publish the Windows-only
      //    picker bridge for the browse panel's icon action」，且官方 directory-browser
      //    插件的 pickNativeDirectory 也只认这个入口。
      // ② 其他载体回退 ctx.uiWorkspace.pickDirectory()（host-native picker）。
      // **② 在桌面壳里必然失败**：host 的 directoryPicker 提供的是 browse 能力，而
      // pickDirectory() → directoryPicker.pick() 要求 native → 抛
      // 「directoryPicker.pick needs the native capability; the composed picker serves "browse"」。
      // 故桌面环境必须优先走 ①。入口每次点击重新解析：bridge 可能晚于本插件加载完成。
      const hostPickSvc = (() => {
        try {
          const svc = ctx && ctx.uiWorkspace
          if (svc && typeof svc.pickDirectory === 'function') return svc
        } catch (err) {
          console.warn('work-personal-secretary client: uiWorkspace 不可用（目录选择降级）', err)
        }
        return null
      })()
      function desktopPickFn() {
        try {
          const fn = (typeof window !== 'undefined') ? window.__DSH_DESKTOP_PICK_DIRECTORY__ : null
          return (typeof fn === 'function') ? fn : null
        } catch (err) {
          return null
        }
      }
      // 两个入口都不可用时为 null —— 页面把「浏览…」按钮禁用并给 tooltip，绝不抛错。
      const uiPick = (desktopPickFn() || hostPickSvc)
        ? function pickDirectory() {
          const desktop = desktopPickFn()
          if (desktop) return desktop()
          return Promise.resolve().then(() => hostPickSvc.pickDirectory()).catch((err) => {
            const msg = String((err && err.message) || err)
            if (msg.indexOf('native capability') >= 0) {
              throw new Error('当前环境没有系统目录选择器，请手动填写路径（或点下方常用位置）')
            }
            throw err
          })
        }
        : null

      // render 透传宿主给的 props（当前只认 initialTab），保证默认页签不变
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'work-personal-secretary',
        order: 35,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t }),
      }, (props) => h(Section, {
        t: t,
        initialTab: props && props.initialTab,
        pickDirectory: uiPick,
        // 「桌面形象」分组的跳转入口（宿主没有编程式设置导航，见 openSettingsSection）
        openSection: openSettingsSection,
      })))
    }

    // uiWorkspace 是硬依赖（DSH：未声明就访问会被 Guard 拒绝；服务缺失时插件进入 waiting）。
    // 可用性一律由上面的 uiPick 运行时判定，UI 侧做降级，不依赖该声明来探测。
    return { apply, inject: ['slots', 'uiWorkspace'] }
  },
})
