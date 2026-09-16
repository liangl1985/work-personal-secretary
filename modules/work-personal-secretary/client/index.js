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
    const BUILD = 'v1.1.3'

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
     * 1.1.3：四步进度条随页签一并下线（设计定稿 §2「删除」）。「安装与检查」页改为
     * 分组卡片：环境依赖（6 项，只读）→ 依赖安装工具 → 子插件（5 项）。
     * 注意：host / node / python / pythonDeps / wps / obsidian 就是原来的「环境」六项；
     * 第七项 subPlugins 探针仍在 /check 里，用于子插件组的降级兜底（见 InstallPage）。
     */
    const DEP_ITEM_IDS = ['host', 'node', 'python', 'pythonDeps', 'wps', 'obsidian']
    /**
     * 环境依赖里的**硬项**（1.1.3 返工 R-1）：Obsidian 与桌面形象是可选件
     * （defaults/install.zh-CN.md 明说可选），不参与「环境已就绪」的判定 ——
     * 否则没装 Obsidian 的使用者永远等不到「环境已就绪」。
     */
    const DEP_REQUIRED_IDS = ['host', 'node', 'python', 'pythonDeps', 'wps']
    /** 可选项（未就绪时用「可选」措辞，不当故障显示） */
    const DEP_OPTIONAL_IDS = ['obsidian']
    /**
     * 随包说明页的两个 id（与宿主契约一致）。说明页是**插件目录里预先做好的 HTML 文件**：
     * 由宿主侧 POST /open-doc 用系统默认程序打开，客户端不做导航、不取内容、不需要凭据。
     * 这也是三轮下来的定论：页内注入（否决）→ 新窗口导航（403 门禁）→ 前端取回写入（撤回），
     * 都不如「宿主直接打开那个文件」简单可靠。
     */
    const DOC_IDS = ['guide', 'help']
    /** 状态 → 文案键（ok | warn | missing | skip） */
    const STATUS_KEYS = { ok: 'statusOk', warn: 'statusWarn', missing: 'statusMissing', skip: 'statusSkip' }
    /** 批量执行状态 → 文案键 / 徽标样式 */
    const RUN_STATE_KEYS = { wait: 'runWait', run: 'runRunning', ok: 'runOk', fail: 'runFail' }
    /** 转圈动画：内联样式表（无构建步骤；按钮里的 ⟳ 用 .wps-spin） */
    const KEYFRAMES = '@keyframes wpsSpin{to{transform:rotate(360deg)}}.wps-spin{display:inline-block;animation:wpsSpin .9s linear infinite}'

    /**
     * P2「安装子插件」：五项的**固定顺序**（客户端写死，与接口是否可达无关，
     * 保证加载中/出错时也能渲染骨架）。nameKey = 接口未给 name 时的中英文名兜底；
     * nature = 性质兜底（self=自研 / standalone=独立项目模块 / third=第三方）。
     */
    const INSTALL_ORDER = ['dsh-work-memory', 'dsh-doc-suite', 'dsh-experts', 'dsh-mermaid', 'workspace-tokenpet']
    const PLUGIN_META = {
      'dsh-work-memory': { nameKey: 'plugMemory', nature: 'self' },
      'dsh-doc-suite': { nameKey: 'plugDocs', nature: 'self' },
      'dsh-experts': { nameKey: 'plugExperts', nature: 'self' },
      'dsh-mermaid': { nameKey: 'plugCharts', nature: 'third' },
      'workspace-tokenpet': { nameKey: 'plugPet', nature: 'standalone' },
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
      ['infosec', 'initDomainInfosec'],
      ['accounting', 'initDomainAccounting'],
      ['hr', 'initDomainHr'],
      ['coding', 'initDomainCoding'],
      ['finance', 'initDomainFinance'],
      ['general', 'initDomainGeneral'],
    ]

    const ZH = {
      nav: '工作秘书',
      title: '工作秘书',
      tabInstall: '安装与检查',
      tabCore: '核心配置',
      tabConfig: '配置',
      tabAbout: '关于与致谢',
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

      // ── 安装与检查（1.1.3：分组卡片 + 页内展开的两个随包网页） ────
      depsGroupTitle: '环境依赖',
      depsGroupSub: '运行环境与文档能力的前置条件',
      depsCount: '{done}/{total} 正常',
      fixToolTitle: '依赖安装工具',
      fixToolBadge: '内置白名单',
      fixToolSub: '上面检测出缺项时，可在这里逐项补齐；命令来自内置白名单，客户端只上报编号',
      fixToolNote: '逐项串行执行，每步回显命令、退出码与输出末尾；不可代执行的项只提供复制命令。',
      plugGroupTitle: '子插件',
      plugGroupSub: '五个子插件可独立安装，装完需重启 DSH',
      plugGroupCount: '{done}/{total} 已装',
      plugGroupUnavailable: '未能读取子插件清单（可点「重新检测」再试）。',
      readOnlyNote: '本页只读检测，不自动改动系统',
      guideOpen: '查看安装引导（{n} 项待处理）',
      guideReady: '环境已就绪',
      helpOpen: '使用说明',
      docOpened: '已打开说明页：',
      docOpenFailed: '未能打开说明页',
      docMissing: '说明页文件缺失',

      // ── 核心配置（1.1.3：门禁；目录与岗位字段由后续任务填充） ──────
      gateTitle: '先满足最低使用需求',
      gatePending: '未就绪',
      gateSub: '核心配置要调用本机 Python 工具来生成结构、读写旧资料，并把身份写进记忆体；下面三项就绪后点「点击此处继续」进入本页。',
      gateContinue: '点击此处继续',
      gateReady: '已就绪，可继续',
      gateItemMemory: '记忆库插件',
      gateItemPython: 'Python 解释器',
      gateItemDeps: 'Python 工具',
      gatePythonHint: '需 3.10 以上（建议 3.12）',
      gateDepsHint: '8 个包（docx / xlsx / pptx / PDF / 图片 / COM）',
      gateGo: '去安装与检查',
      gateNote: '三项都在「安装与检查」页检测与处理。记忆库工作目录在本页填写，不作为解锁条件。',
      gateChecking: '检测中…',
      gateLoadFailed: '未能取到环境检测结果',
      coreDirsTitle: '目录与岗位',
      coreDirsSub: '三项都填写后才能保存；两个目录都要填，保存后按下面的执行链一次做完。',
      coreFieldMemoryDir: '记忆库目录',
      coreFieldMemoryDirHint: '必填。推荐新建一个空文件夹专用，或放进长期使用的主工作区；不建议分散在不同盘符 —— 跨文件夹使用时可能受权限范围限制，出现写入失败或同步中断。',
      coreFieldObsidianDir: 'Obsidian 知识库目录',
      coreFieldObsidianDirHint: '脚本在此建立知识库结构，并把记忆镜像区 00_全局记忆 与记忆库关联',
      coreFieldDomain: '工作岗位',
      coreFieldDomainHint: '五个预置岗位对应信息安全 / 财务 / 人力资源 / 代码编程 / 金融五个行业域，均为可直接写入身份的预置正文；都不是时可自填，新建后自动出现在这里并选中',
      setupStateFailed: '未能取到当前生效值（可手动填写）',
      coreDomainNeedsContent: '已带入当前岗位名称，请补充岗位内容（或点「自动生成」）后再保存',
      coreDomainNew: '都不是（新建岗位…）',
      coreDomainPlaceholder: '请选择…',
      modalCustomSuffix: '（自定义）',
      chainMarkCheck: '检',
      coreSave: '保存配置并开始',
      coreSaveHintWait: '三项都填写后才能保存；保存会先做可用性检查，通过后自动执行',
      coreSaveHintReady: '点「保存配置并开始」即触发：先做可用性检查，通过后依次建立两个目录、建立关联、写入身份',
      chainTitle: '一键配置',
      chainSub: '按顺序执行；任一步失败就停在该步，已建成的部分保留，可从失败处重试。',
      chainBadgeWait: '待保存',
      chainBadgeRun: '执行中…',
      chainBadgeDone: '已完成',
      chainBadgeFail: '已中断',
      chainStepCheck: '可用性检查',
      chainStepCheckSub: '环境就绪（记忆库插件 / Python / Python 工具）· 两个目录路径合法且可写 · 两目录同一工作区 · 目标目录无冲突',
  chainStepCheckWarn: '提示：',
      chainStepMemory: '建立记忆库目录',
      chainStepMemorySub: '骨架 PROJECTS / DAILY / ARCHIVE；MEMORY.md 写入使用者身份（占位，待本页填写）；PROJECTS/工作秘书.md 与 USER.md、GRAPH.json',
      chainStepMigrate: '迁移旧记忆库',
      chainStepMigrateSub: '把旧记忆库里的文件补进新目录：只补缺失、不覆盖同名不同内容的文件；旧目录保留不动；逐文件校验，失败回滚',
      chainStepMigrateNone: '无需迁移（未检测到旧记忆库，或旧目录与目标相同）',
      chainStepMigrateDone: '已迁移 {n} 个文件（其中 {conflict} 个同名冲突已保留目标）',
      chainStepMigrateKept: '旧目录保留不动',
      chainStopped: '已在「{step}」停止：{reason}（后续步骤未执行）',
      chainStepKnowledge: '建立知识库目录',
      chainStepKnowledgeSub: '主页入口、模块骨架、00_全局记忆 镜像区、工具/（技能 · 脚本 · MCP）、.obsidian 最小配置',
      chainStepLink: '建立两者关联',
      chainStepLinkSub: '把记忆镜像写入知识库的 00_全局记忆 区，并回写记忆库目录与镜像目录设置',
      chainStepIdentity: '写入岗位身份',
      chainStepIdentitySub: '把所选岗位或自填内容整条写入「使用者身份」条目；助手人设不在本步内',
      chainRetry: '重试',
      chainRetryHint: '从失败的那一步继续（已完成的部分保留；重复执行只补缺失）',
      importTitle: '已有旧内容要带过来？',
      importSub: '本机已有知识库或记忆文件时，可选文件夹带过来',
      importBrowse: '浏览… 选择知识库或记忆文件夹',
      importNote: '纪律：只读源目录、只补缺失、不覆盖现有文件、先给预览再落盘。',
      importPlaceholder: '选择后先列清单，由你勾选要带过来的条目，确认后才写入。',
      importPicked: '已选目录：',
      importLater: '清单与勾选（条目归类）在后续版本提供；本轮先落定入口与纪律。',
      modalTitle: '新建岗位',
      modalName: '岗位名称',
      modalNameHint: '会出现在岗位下拉里，建议用中文简称；10 字以内',
      modalContent: '岗位内容',
      modalContentHint: '200 字以内。点「自动生成」时，会把岗位名称与你已填的内容交给当前会话的模型；不点就不发送',
      modalGen: '自动生成',
      modalGenRunning: '生成中…',
      modalGenDone: '已生成，可直接编辑或重试',
      modalGenNoModel: '当前 profile 未提供模型服务，请手填',
      modalGenFailed: '生成失败',
      modalNote: '只写使用者身份本身，不写助手人设；结果只作预览，可替换或重试。保存后整条写入记忆体「使用者身份」条目（全局记忆 · tag=关键）。',
      modalCancel: '取消',
      modalSave: '保存岗位',
      modalNameRequired: '请先填写岗位名称',
      modalOver: '内容超过 {n} 字，请精简后再保存',
      modalNameOver: '岗位名称不超过 {n} 字，请精简后再保存',
      modalCount: '{n}/{max} 字',
      coreDomainMissing: '请选择工作岗位',
      checking: '检测中…',
      recheck: '重新检测',
      checkedAt: '检测时间',
      retry: '重试',
      loadFailed: '环境检测失败',
      loadFailedHint: '未能从本机服务取到数据：可能集成体尚未在宿主侧启用，或该路由还没注册。确认后点「重试」。',
      emptyList: '接口未返回环境项。',
      statusUnknown: '未知',
      statusOptional: '可选',
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
      descObsidian: 'Obsidian（知识库组件）',
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
      footNote: '默认只读检测；只有你点「补齐选中项」才会执行安装。命令来自内置白名单，不接受外部输入。',

      // ── 安装子插件（P2） ──────────────────────────────────────────
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
      natureStandalone: '独立项目模块',
      natureThird: '第三方',
      plugStatusUpToDate: '已是最新',
      plugStatusInstallable: '可安装',
      plugStatusUpdatable: '可更新',
      // ── 2026-09-14 增补：安装页的残留提示 + repoRoot 可配置（设置值 / patch / 自动探测） ──
      plugResidueHint: '检测到未登记的残留目录（依赖与 bundles 均未登记）：本项按「未安装」处理，点「安装」可覆盖重装。',
      repoRootFieldLabel: '集成体仓库目录',
      repoRootFieldEmpty: '留空 = 自动探测',
      repoRootFieldHint: '留空 = 自动探测；本机若为 file: / link: 链接安装，安装器会自动推导并写回。填写用绝对路径，须包含 modules/<id>/package.json。',
      repoRootFieldSave: '保存',
      repoRootFieldSaving: '保存中…',
      repoRootFieldSaved: '已保存，免重启生效',
      repoRootFieldCleared: '已清空，回到自动探测',
      repoRootFieldFailed: '保存失败',
      repoRootSourceNow: '当前来源',
      repoRootSrcSettings: '设置',
      repoRootSrcConfig: '部署配置',
      repoRootSrcPatch: 'profile 配置',
      repoRootSrcAncestor: '自动推导',
      repoRootSrcCommon: '常见位置',
      repoRootSrcNone: '未找到',
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
      initDomainInfosec: '信息安全',
      initDomainAccounting: '财务',
      initDomainHr: '人力资源',
      initDomainCoding: '代码编程',
      initDomainFinance: '金融',
      initDomainGeneral: '通用职能',
      initDomainPlaceholder: '请选择…',
      initDomainRequired: '请先选择你的工作方向',
      initBrowse: '浏览…',
      initBrowseTip: '选择目录',
      // 5) 文案改准确：browse 能力下按钮本就可点，只有三条路都不通时才提示（旧说法已不成立）
      initBrowseUnavailable: '无法打开目录选择器：请直接手动输入路径；桌面外壳下可用系统目录对话框。',
      dirBrowserTitle: '选择目录',
      dirBrowserLoading: '读取中…',
      dirBrowserEmpty: '这个目录里没有子目录',
      dirBrowserTruncated: '目录过多，只显示前若干项',
      dirBrowserPick: '选用此目录',
      dirBrowserNewName: '新目录名',
      dirBrowserCreate: '新建目录',
      dirBrowserUp: '返回上级',
      dirBrowserCancel: '取消',
      dirBrowserFailed: '目录读取失败',
      dirBrowserNativeOnly: '系统目录对话框未能打开',
      dirBrowserNoService: '宿主暂不提供目录浏览接口',
      dirBrowserNewFailed: '新建目录失败',
      dirBrowserNewNameRequired: '请先填写新目录名',
      initCandDetectedWorkspace: '使用探测到的工作区',
      initCandDefaultMemory: '使用默认（<DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory）',
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
      cfgOn: '开',
      cfgOff: '关',
      cfgRevision: '版本 r{n}',
      cfgAppliedLive: '改动免重启生效',
      cfgT5Advanced: '高级设置（{n} 项）',

      cfgGroupMemory: '记忆库',
      cfgMemoryLead: '执行层长期记忆（dsh-work-memory）。改动免重启生效；未覆盖的键取部署默认值。',

      cfgGroupExperts: '专家库',
      cfgExpertsLead: '岗位专家库（dsh-experts）。默认一位都不常驻（身份由 work-memory 记忆承担）；其余由「问题归属判断」决定是否补位，注入上限写死 4。',
      cfgExpPreview: '实时预览',
      cfgExpPreviewHint: '输入一段任务文本，按当前阈值试算注入名单与打分理由（只读，不产生写入）',
      cfgExpPreviewPlaceholder: '例如：这份合同的付款节点与税务怎么处理？',
      cfgExpPreviewGo: '试算',
      cfgExpPreviewRunning: '试算中…',
      cfgExpPreviewEmpty: '输入任务文本后点「试算」。',
      cfgExpPreviewReason: '判定理由',
      cfgExpPreviewSelected: '注入名单',
      cfgExpPreviewNone: '没有专家命中关键词：本轮按通用助手处理（宁缺勿滥）。',
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
      cfgDocLead: '文档能力（dsh-doc-suite）随包提供，此处只展示依赖与技能自检状态。',
      cfgDocSettingsLead: '这些设置写入 dsh-doc-suite 命名空间的用户层；密钥不回显明文。',
      cfgProviderArk: '火山引擎（方舟）',
      cfgFMediaProvider: '生图平台',
      cfgFMediaImageEnabled: '优先生图',
      cfgFMediaImageModel: '模型 ID',
      cfgFMediaImageSize: '出图尺寸',
      cfgFMediaImageTimeoutMs: '请求超时（毫秒）',
      cfgFMediaImageRetries: '失败重试次数',
      cfgFMediaImageFallbackToVector: '失败回退矢量',
      cfgFMediaVideoEnabled: '启用生视频（默认关）',
      cfgFMediaVideoModel: '生视频模型 ID',
      cfgFMediaArkApiKey: 'ARK 密钥',
      cfgFMediaArkEndpoint: '方舟端点',
      cfgDocDeps: '依赖状态',
      cfgDocDepsHint: '取自「安装与检查」页的环境探测结果（只读）',
      cfgDocSkills: '五技能落盘',
      cfgDocSkillMediaGen: '媒体素材',
      cfgDocSkillHint: '技能落盘状态由文档模块的自检命令给出；本页只列清单，未检测不代表缺失。',
      cfgDocDoctor: '自检请在文档模块里运行 /doc-doctor。',
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
      cfgHMemoryDir: '留空 = <DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory',
      cfgFObsidianSyncDir: 'Obsidian 镜像目录',
      cfgHObsidianSyncDir: '留空 = 不同步；建议指向 vault 下的记忆镜像区',
      cfgFExpertsEnabled: '专家库总开关',
      cfgHExpertsEnabled: '关闭后不注入任何 persona；专家工具与命令仍可用',
      cfgFInjectOrder: '专家注入顺序',
      cfgHInjectOrder: 'runtime 上下文里的顺序，越小越靠前',
      cfgFDefaultDomain: '本人岗位域',
      cfgHDefaultDomain: '决定任务优先从哪个专业角度拆解，也是身份专家的兜底来源',
      cfgFIdentityExpert: '身份专家',
      cfgHIdentityExpert: '常驻注入的唯一身份专家 id（如 infosec-ics-security）；留空 = 不常驻（身份由 work-memory 记忆承担）',
      cfgFEnabledDomains: '匹配范围·域',
      cfgHEnabledDomains: '逗号分隔（如 infosec,accounting）；留空 = 全部专家参与匹配',
      cfgFEnabledExperts: '匹配范围·专家',
      cfgHEnabledExperts: 'id 逗号分隔；留空 = 不收窄。范围外仍可用 /expert use 临时注入',
      cfgFExpertCatalogEnabled: '专家库目录段',
      cfgHExpertCatalogEnabled: '列出六域成员与可用能力，供模型判断问题归属；稳定段，不占每轮注入预算',
      cfgFDisciplineEnabled: '交付层纪律块',
      cfgHDisciplineEnabled: '从项目记忆读【纪律块 v1】，每轮注入、不随专家裁剪丢弃',
      cfgFDisciplineMemoryDir: '纪律块记忆库根',
      cfgHDisciplineMemoryDir: '留空 = 取记忆库设置里的 memoryDir，再退到 <DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory',
      cfgFExpertInjectDetail: '注入形态',
      cfgHExpertInjectDetail: '每轮注入形态：auto（默认）—— 首轮把命中的专家全部以精简卡代入（候选全景），之后判断确实要干活的专家时注入其全文；card = 全部精简卡；full = 全部全文（旧行为逃生舱）',
      cfgFExpertInjectBudgetChars: '注入上限（字符）',
      cfgHExpertInjectBudgetChars: '每轮注入的字符上限，默认 15000（按**最大可能消费**定档：单篇全文上限 3600 × 位数硬边界 4 + 块头尾注与处理路径）。它只是上限：超出即截断并标注，**不再降级**；真正的安全红线是 20000',
      cfgDetailAuto: 'auto（首轮全景给命中专家卡 → 干活轮给要干活专家的全文）',
      cfgDetailCard: 'card（全部精简卡）',
      cfgDetailFull: 'full（全文，旧行为）',
      cfgFExpertSecondThreshold: '第 2/3 位门槛',
      cfgHExpertSecondThreshold: '其分数 ≥ 第 1 位 × 该值时才注入（仅注入上限 ≥ 2 时生效）',
      cfgFExpertGeneralMax: '通用专家配额',
      cfgHExpertGeneralMax: '通用型专家（核查/排版/文档/演示/设计）的独立配额，默认 1；0 = 不保底',
      cfgFExpertFullHitMax: '干活轮全文位数',
      cfgHExpertFullHitMax: '干活轮按证据取「最大 + 次大」共几位专家给全文（默认 2，并列取任意两位；上限 4）',
      cfgFExpertGeneralMinEvidence: '通用专家门槛',
      cfgHExpertGeneralMinEvidence: '通用型专家的绝对门槛：关键词证据 ≥ 该值即可入选（默认 0.2 = 命中 1 词）',
      cfgFSkillInjectEnabled: '能力层指针',
      cfgHSkillInjectEnabled: '识别到技能就注入一行「去哪拿」的指针；不占 expertInjectMax 配额',
      cfgFSkillBudgetChars: '能力层预算（字符）',
      cfgHSkillBudgetChars: '默认 300（约 3 条指针）；0 = 不注入指针，persona 不受影响',
      cfgFExpertShowBanner: '显示「当前专家视角」',
      cfgHExpertShowBanner: '注入时显示本轮用的是哪位专家',
      cfgFExpertSetupDone: '安装引导已完成',
      cfgHExpertSetupDone: '重置为关可让「你的工作方向是？」下次再问一次',
    }

    const EN = {
      nav: 'Work Secretary',
      title: 'Work Secretary',
      tabInstall: 'Install & Check',
      tabCore: 'Core setup',
      tabConfig: 'Settings',
      tabAbout: 'About & Credits',
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

      // ── Install & Check (1.1.3: grouped cards + in-page docs) ─────
      depsGroupTitle: 'Environment dependencies',
      depsGroupSub: 'Prerequisites for the runtime and the document capability',
      depsCount: '{done}/{total} ok',
      fixToolTitle: 'Dependency installer',
      fixToolBadge: 'Built-in allow-list',
      fixToolSub: 'When the checks above find something missing, install it item by item here; every command comes from the built-in allow-list and the client only reports ids',
      fixToolNote: 'Runs one item at a time, echoing the command, exit code and the tail of the output; items that cannot be run automatically only offer a command to copy.',
      plugGroupTitle: 'Sub-plugins',
      plugGroupSub: 'The five sub-plugins install independently; restart DSH afterwards',
      plugGroupCount: '{done}/{total} installed',
      plugGroupUnavailable: 'Could not read the sub-plugin list (press Re-check to try again).',
      readOnlyNote: 'This page only inspects; it never changes the system on its own',
      guideOpen: 'Open install guide ({n} item(s) pending)',
      guideReady: 'Environment ready',
      helpOpen: 'User guide',
      docOpened: 'Opened: ',
      docOpenFailed: 'Could not open the page',
      docMissing: 'The page file is missing',

      // ── Core setup (1.1.3: gate; fields filled by a later task) ───
      gateTitle: 'Meet the minimum requirements first',
      gatePending: 'Not ready',
      gateSub: 'Core setup uses the local Python tools to generate structure, read and write existing material, and write the identity into the memory store; once all three items below are ready, press "Continue here" to open this page.',
      gateContinue: 'Continue here',
      gateReady: 'Ready to continue',
      gateItemMemory: 'Memory sub-plugin',
      gateItemPython: 'Python interpreter',
      gateItemDeps: 'Python tools',
      gatePythonHint: '3.10 or newer required (3.12 recommended)',
      gateDepsHint: '8 packages (docx / xlsx / pptx / PDF / images / COM)',
      gateGo: 'Go to Install & Check',
      gateNote: 'All three are checked and handled on the Install & Check page. The memory directory is filled in on this page and is not an unlock condition.',
      gateChecking: 'Checking…',
      gateLoadFailed: 'Could not read the environment check',
      coreDirsTitle: 'Directories & job',
      coreDirsSub: 'All three fields are required; saving runs the whole chain below in one go.',
      coreFieldMemoryDir: 'Memory directory',
      coreFieldMemoryDirHint: 'Required. Create an empty folder dedicated to the Work Secretary, or put it inside the workspace you use long-term; avoid spreading the two directories across different drives — cross-folder use can hit permission-scope limits, causing failed writes or interrupted sync.',
      coreFieldObsidianDir: 'Obsidian vault directory',
      coreFieldObsidianDirHint: 'The vault structure is created here, and the 00_全局记忆 mirror area is linked to the memory store',
      coreFieldDomain: 'Job',
      coreFieldDomainHint: 'Five presets cover information security / accounting / HR / coding / finance, each a ready-to-write identity text; choose "None of these" to fill your own — it then appears in this list and is selected',
      setupStateFailed: 'Could not read the current values (fill them in manually)',
      coreDomainNeedsContent: 'The current job name was filled in; add the job description (or press Generate) before saving',
      coreDomainNew: 'None of these (new job…)',
      coreDomainPlaceholder: 'Select…',
      modalCustomSuffix: ' (custom)',
      chainMarkCheck: 'C',
      coreSave: 'Save and start',
      coreSaveHintWait: 'All three fields are required; saving runs the availability check first, then executes automatically',
      coreSaveHintReady: 'Pressing "Save and start" runs the availability check first, then creates both directories, links them and writes the identity',
      chainTitle: 'One-click setup',
      chainSub: 'Runs in order; on failure it stops at that step, keeps what was created and can be retried from there.',
      chainBadgeWait: 'Not started',
      chainBadgeRun: 'Running…',
      chainBadgeDone: 'Done',
      chainBadgeFail: 'Stopped',
      chainStepCheck: 'Availability check',
      chainStepCheckSub: 'Environment ready (memory sub-plugin / Python / Python tools) · both directories valid and writable · same workspace · no target conflict',
  chainStepCheckWarn: 'Notice: ', 
      chainStepMemory: 'Create the memory directory',
      chainStepMemorySub: 'Skeleton PROJECTS / DAILY / ARCHIVE; the user identity placeholder in MEMORY.md; PROJECTS/工作秘书.md plus USER.md and GRAPH.json',
      chainStepMigrate: 'Migrate the old memory store',
      chainStepMigrateSub: 'Copies files from the old memory store into the new directory: only missing files are added and existing files are never overwritten; the old directory is left untouched; every file is checksummed and the step rolls back on failure',
      chainStepMigrateNone: 'Nothing to migrate (no old memory store found, or it is the same as the target)',
      chainStepMigrateDone: 'Migrated {n} file(s); {conflict} name conflict(s) kept the target file',
      chainStepMigrateKept: 'the old directory is left untouched',
      chainStopped: 'Stopped at "{step}": {reason} (later steps were not run)',
      chainStepKnowledge: 'Create the vault directory',
      chainStepKnowledgeSub: 'Home entry, module skeleton, the 00_全局记忆 mirror area, 工具/ (skills · scripts · MCP), a minimal .obsidian config',
      chainStepLink: 'Link the two',
      chainStepLinkSub: 'Write the memory mirror into the vault 00_全局记忆 area and write the memory/mirror directories back to settings',
      chainStepIdentity: 'Write the job identity',
      chainStepIdentitySub: 'Rewrites the "使用者身份" entry with the chosen preset or your own text; the assistant persona is not part of this step',
      chainRetry: 'Retry',
      chainRetryHint: 'Continues from the failed step (finished parts are kept; re-running only fills what is missing)',
      importTitle: 'Bring existing content over?',
      importSub: 'If you already have a vault or memory files on this machine, pick the folder to bring them in',
      importBrowse: 'Browse… choose a vault or memory folder',
      importNote: 'Rules: read the source only, add what is missing, never overwrite existing files, show a preview before writing.',
      importPlaceholder: 'After choosing, a list appears and you tick the entries to bring over; nothing is written before you confirm.',
      importPicked: 'Selected directory: ',
      importLater: 'The list and the per-entry selection (how items are categorized) come in a later version; this version settles the entry point and the rules.',
      modalTitle: 'New job',
      modalName: 'Job name',
      modalNameHint: 'Appears in the job list; a short label works best. Up to 10 characters.',
      modalContent: 'Job description',
      modalContentHint: 'Up to 200 characters. Pressing "Generate" sends the job name and what you have filled in to the current session model; nothing is sent unless you press it',
      modalGen: 'Generate',
      modalGenRunning: 'Generating…',
      modalGenDone: 'Generated — edit it or try again',
      modalGenNoModel: 'This profile provides no model service; please fill it in by hand',
      modalGenFailed: 'Generation failed',
      modalNote: 'Only the user identity itself is written, never the assistant persona; the result is a preview you can replace or retry. On save it rewrites the "使用者身份" entry (global memory, tag=关键).',
      modalCancel: 'Cancel',
      modalSave: 'Save job',
      modalNameRequired: 'Enter a job name first',
      modalOver: 'Longer than {n} characters — please shorten it before saving',
      modalNameOver: 'The job name must be at most {n} characters — please shorten it',
      modalCount: '{n}/{max}',
      coreDomainMissing: 'Choose a job',
      checking: 'Checking…',
      recheck: 'Re-check',
      checkedAt: 'Checked at',
      retry: 'Retry',
      loadFailed: 'Environment check failed',
      loadFailedHint: 'No data from the local service: the integrator may be disabled on the host side, or the route is not registered yet. Confirm, then press Retry.',
      emptyList: 'The service returned no environment items.',
      statusUnknown: 'unknown',
      statusOptional: 'optional',
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
      descObsidian: 'Obsidian (knowledge base)',
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
      footNote: 'Read-only by default; installation only runs when you press "Install selected". Every command comes from a built-in allow-list — no external input is accepted.',

      // ── Install sub-plugins (P2) ──────────────────────────────────
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
      natureStandalone: 'Standalone module',
      natureThird: 'Third-party',
      plugStatusUpToDate: 'Up to date',
      plugStatusInstallable: 'Installable',
      plugStatusUpdatable: 'Updatable',
      // ── added 2026-09-14: residue hint + configurable repoRoot ──
      plugResidueHint: 'An unregistered leftover directory was found (neither dependencies nor bundles list it). It is treated as not installed — press Install to replace it.',
      repoRootFieldLabel: 'Integrator repository',
      repoRootFieldEmpty: 'Empty = auto-detect',
      repoRootFieldHint: 'Empty = auto-detect. For file: / link: installs the installer derives it and writes it back automatically. Use an absolute path that contains modules/<id>/package.json.',
      repoRootFieldSave: 'Save',
      repoRootFieldSaving: 'Saving…',
      repoRootFieldSaved: 'Saved — takes effect without restart',
      repoRootFieldCleared: 'Cleared — back to auto-detect',
      repoRootFieldFailed: 'Save failed',
      repoRootSourceNow: 'Current source',
      repoRootSrcSettings: 'settings',
      repoRootSrcConfig: 'deploy config',
      repoRootSrcPatch: 'profile config',
      repoRootSrcAncestor: 'auto-derived',
      repoRootSrcCommon: 'common location',
      repoRootSrcNone: 'not found',
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
      initDomainInfosec: 'Information security',
      initDomainAccounting: 'Accounting',
      initDomainHr: 'HR',
      initDomainCoding: 'Coding',
      initDomainFinance: 'Finance',
      initDomainGeneral: 'General functions',
      initDomainPlaceholder: 'Select…',
      initDomainRequired: 'Choose your job domain first',
      initBrowse: 'Browse…',
      initBrowseTip: 'Choose a directory',
      initBrowseUnavailable: 'The directory picker is unavailable: type the path manually, or use the desktop shell for the native dialog.',
      dirBrowserTitle: 'Choose a directory',
      dirBrowserLoading: 'Loading…',
      dirBrowserEmpty: 'No subdirectories here',
      dirBrowserTruncated: 'Too many entries — only the first ones are shown',
      dirBrowserPick: 'Use this directory',
      dirBrowserNewName: 'New folder name',
      dirBrowserCreate: 'Create folder',
      dirBrowserUp: 'Up one level',
      dirBrowserCancel: 'Cancel',
      dirBrowserFailed: 'Could not read the directory',
      dirBrowserNativeOnly: 'The native directory dialog could not be opened',
      dirBrowserNoService: 'This host does not expose a directory browsing API yet',
      dirBrowserNewFailed: 'Could not create the folder',
      dirBrowserNewNameRequired: 'Enter a folder name first',
      initCandDetectedWorkspace: 'Use detected workspace',
      initCandDefaultMemory: 'Use default (<DSH_HOME or ~/.dsh>/data/dsh-work-memory/memory)',
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
      cfgOn: 'on',
      cfgOff: 'off',
      cfgRevision: 'revision r{n}',
      cfgAppliedLive: 'applies without a restart',
      cfgT5Advanced: 'Advanced ({n})',

      cfgGroupMemory: 'Memory',
      cfgMemoryLead: 'Long-term execution memory (dsh-work-memory). Changes apply without a restart; keys you do not override keep the deployment defaults.',

      cfgGroupExperts: 'Experts',
      cfgExpertsLead: 'Domain expert library (dsh-experts). Nobody is resident by default (identity comes from work-memory); experts join when the task calls for them, with the cap hard-wired to 4.',
      cfgExpPreview: 'Live preview',
      cfgExpPreviewHint: 'Type a task and preview the injected roster with scoring reasons (read-only, nothing is written)',
      cfgExpPreviewPlaceholder: 'e.g. How should the payment milestones and taxes of this contract be handled?',
      cfgExpPreviewGo: 'Preview',
      cfgExpPreviewRunning: 'Scoring…',
      cfgExpPreviewEmpty: 'Type a task, then press Preview.',
      cfgExpPreviewReason: 'Decision',
      cfgExpPreviewSelected: 'Injected roster',
      cfgExpPreviewNone: 'No expert matched a keyword: this turn stays with the general assistant.',
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
      cfgDocLead: 'The document suite (dsh-doc-suite) ships with the integrator; this section shows dependency and skill self-check status only.',
      cfgDocSettingsLead: 'These settings are written to the user layer of the dsh-doc-suite namespace; secrets are never echoed back.',
      cfgProviderArk: 'Volcengine (Ark)',
      cfgFMediaProvider: 'Image provider',
      cfgFMediaImageEnabled: 'Prefer image generation',
      cfgFMediaImageModel: 'Model ID',
      cfgFMediaImageSize: 'Image size',
      cfgFMediaImageTimeoutMs: 'Request timeout (ms)',
      cfgFMediaImageRetries: 'Retry count',
      cfgFMediaImageFallbackToVector: 'Fall back to vector',
      cfgFMediaVideoEnabled: 'Enable video generation (off by default)',
      cfgFMediaVideoModel: 'Video model ID',
      cfgFMediaArkApiKey: 'Ark API key',
      cfgFMediaArkEndpoint: 'Ark endpoint',
      cfgDocDeps: 'Dependency status',
      cfgDocDepsHint: 'Taken from the environment probe on the Install & Check page (read-only)',
      cfgDocSkills: 'Five skills on disk',
      cfgDocSkillMediaGen: 'Media assets',
      cfgDocSkillHint: 'On-disk skill status comes from the document module self-check; this page only lists them, so "not checked" does not mean missing.',
      cfgDocDoctor: 'Run /doc-doctor inside the document module for a self-check.',
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
      cfgHMemoryDir: 'Empty = <DSH_HOME or ~/.dsh>/data/dsh-work-memory/memory',
      cfgFObsidianSyncDir: 'Obsidian mirror directory',
      cfgHObsidianSyncDir: 'Empty = no mirror; point it at the memory mirror area of your vault',
      cfgFExpertsEnabled: 'Expert library master switch',
      cfgHExpertsEnabled: 'With this off no persona is injected; expert tools and commands still work',
      cfgFInjectOrder: 'Expert injection order',
      cfgHInjectOrder: 'Position in the runtime context; smaller comes first',
      cfgFDefaultDomain: 'Job domain',
      cfgHDefaultDomain: 'Decides which perspective leads the breakdown; also the fallback source of the identity expert',
      cfgFIdentityExpert: 'Identity expert',
      cfgHIdentityExpert: 'Id of the single resident expert (e.g. infosec-ics-security); empty = none resident (identity comes from work-memory)',
      cfgFEnabledDomains: 'Match scope · domains',
      cfgHEnabledDomains: 'Comma separated (e.g. infosec,accounting); empty = every expert may match',
      cfgFEnabledExperts: 'Match scope · experts',
      cfgHEnabledExperts: 'Comma separated ids; empty = no narrowing. Experts outside the scope can still be injected with /expert use',
      cfgFExpertCatalogEnabled: 'Expert catalog block',
      cfgHExpertCatalogEnabled: 'Lists the six domains and available capabilities so the model can route the task; a stable block that does not consume the injection budget',
      cfgFDisciplineEnabled: 'Delivery discipline block',
      cfgHDisciplineEnabled: 'Reads [discipline block v1] from project memory and injects it every turn, never trimmed by expert selection',
      cfgFDisciplineMemoryDir: 'Discipline memory root',
      cfgHDisciplineMemoryDir: 'Empty = take memoryDir from the memory settings, falling back to <DSH_HOME or ~/.dsh>/data/dsh-work-memory/memory',
      cfgFExpertInjectDetail: 'Injection detail',
      cfgHExpertInjectDetail: 'Per-turn injection mode: auto (default) — the first turn loads every matched expert as a compact card (a candidate overview), later turns inject the full persona of the experts that actually need to work; card = compact cards only; full = full personas (legacy escape hatch)',
      cfgFExpertInjectBudgetChars: 'Injection cap (chars)',
      cfgHExpertInjectBudgetChars: 'Per-turn character cap, default 15000 (sized for the maximum possible load: 3600 chars per persona × 4 + headers and path hint). It is a cap only: overflow is truncated and noted, there is no downgrade chain; the hard safety limit is 20000',
      cfgDetailAuto: 'auto (overview cards first, then full personas for work)',
      cfgDetailCard: 'card (compact cards only)',
      cfgDetailFull: 'full (full personas)',
      cfgFExpertSecondThreshold: '2nd/3rd cutoff',
      cfgHExpertSecondThreshold: 'A candidate needs score ≥ top score × this value (only with a limit of 2 or more)',
      cfgFExpertGeneralMax: 'General expert quota',
      cfgHExpertGeneralMax: 'Separate quota for general experts (fact-check / typesetting / office / slides / design), default 1; 0 = no reserved seat',
      cfgFExpertFullHitMax: 'Max full personas',
      cfgHExpertFullHitMax: 'How many experts get a full persona per working turn (default 2: the top two by evidence, ties broken arbitrarily; hard limit 4)',
      cfgFExpertGeneralMinEvidence: 'General expert cutoff',
      cfgHExpertGeneralMinEvidence: 'Absolute evidence cutoff for general experts: keyword evidence ≥ this value qualifies (default 0.2 = one keyword)',
      cfgFSkillInjectEnabled: 'Capability pointers',
      cfgHSkillInjectEnabled: 'Injects one "where to get it" pointer line per matched skill; does not count against expertInjectMax',
      cfgFSkillBudgetChars: 'Capability budget (chars)',
      cfgHSkillBudgetChars: 'Default 300 (about three pointer lines); 0 = inject no pointers, personas unaffected',
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
      ['dsh-mermaid', '思维链与图表', '第三方', 'MIT', '把 Mermaid 代码块渲染为 SVG 图，可在图与代码间切换，支持全屏查看与导出'],
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

      // ── 安装与检查 / 核心配置（1.1.3：分组卡片 · 页内展开 · 门禁） ──
      actionsTop: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 6px' },
      metaNote: { fontSize: '12px', color: '#8a8f98', margin: '0 0 12px' },
      metaLink: {
        appearance: 'none', border: 0, background: 'transparent', color: '#1d4ed8',
        textDecoration: 'underline', cursor: 'pointer', font: 'inherit', fontSize: '12px', padding: 0,
      },
      groupCount: { marginLeft: 'auto' },
      gatedBody: { opacity: 0.45, pointerEvents: 'none' },
      gateCard: { borderColor: '#f0d9b5', background: '#fffdf7' },
      coreFieldRow: { padding: '8px 0', borderTop: '1px solid #f6f7f9', marginBottom: '2px' },
      saveBar: {
        display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
        marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #eceef1',
      },
      chainNo: { minWidth: '20px', textAlign: 'center' },
      modalWrap: { position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' },
      modalMask: { position: 'absolute', inset: 0, background: 'rgba(15,23,42,.38)' },
      modalBox: {
        position: 'relative', width: '480px', maxWidth: 'calc(100vw - 40px)', background: '#fff',
        borderRadius: '14px', boxShadow: '0 24px 60px rgba(15,23,42,.3)', overflow: 'hidden',
      },
      modalHead: { padding: '12px 14px', fontSize: '14px', fontWeight: 650, borderBottom: '1px solid #eceef1' },
      modalBody: { padding: '12px 14px 4px' },
      modalFoot: { display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '10px 14px', borderTop: '1px solid #eceef1', background: '#fbfcfd' },
      // 应用内目录浏览器（方案 A）：复用既有 modal 视觉，只补面包屑与列表两条原语
      crumbs: { display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' },
      crumbBtn: {
        appearance: 'none', border: 0, background: 'transparent', color: '#1d4ed8', cursor: 'pointer',
        font: 'inherit', fontSize: '12px', padding: '1px 4px', textDecoration: 'underline',
      },
      dirList: {
        border: '1px solid #eef0f2', borderRadius: '9px', background: '#fbfcfd',
        maxHeight: '240px', overflow: 'auto', margin: '6px 0',
      },
      dirItem: {
        display: 'block', width: '100%', textAlign: 'left', appearance: 'none', border: 0,
        borderBottom: '1px solid #f2f4f7', background: 'transparent', cursor: 'pointer',
        font: 'inherit', fontSize: '12.5px', color: '#1f2328', padding: '7px 10px',
      },
      textarea: {
        width: '100%', font: 'inherit', fontSize: '12.5px', padding: '6px 8px', border: '1px solid #dfe1e5',
        borderRadius: '8px', resize: 'vertical', minHeight: '84px', color: '#1f2328', boxSizing: 'border-box',
      },
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
        color: '#1f2328', lineHeight: 1.4, whiteSpace: 'nowrap',
      },
      // 「浏览…」这类窄按钮：flex 行里不压缩，保证中文单行（1.1.3 真机反馈：曾被挤成竖排）
      btnPick: { whiteSpace: 'nowrap', flexShrink: 0, minWidth: '56px' },
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
      cfgFold: { border: '1px solid #eef0f2', borderRadius: '10px', marginTop: '10px', background: '#fcfcfd' },
      cfgFoldSummary: { cursor: 'pointer', padding: '9px 12px', fontSize: '12.5px', fontWeight: 600, color: '#4b5563' },
      cfgFoldBody: { padding: '0 12px 10px' },
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

    /**
     * 性质归一：self = 自研 / standalone = 独立项目模块 / third = 第三方 / '' = 未知。
     * 「独立项目模块」= 自持源码、构建产物、文档与素材，但由上游项目独立化而来
     * （上游版权、许可与致谢见该模块 LICENSE / NOTICE）—— 与"第三方整包引入"区分开。
     */
    function natureKey(value) {
      const s = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
      if (s === '') return ''
      if (s.indexOf('自研') >= 0 || s.indexOf('self') >= 0 || s.indexOf('first') >= 0
        || s.indexOf('bundled') >= 0 || s.indexOf('builtin') >= 0) return 'self'
      if (s.indexOf('独立') >= 0 || s.indexOf('standalone') >= 0 || s.indexOf('independent') >= 0) return 'standalone'
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
      // 2026-09-14：服务端 installed 已改为「登记为准」（依赖登记 + bundles 命中 + 目录在），
      // 未安装时 installedVersion 恒为 null。这里再兜一层：**仅当服务端显式说 installed=false 时**
      // 忽略 installedVersion（否则残留目录里的版本号会被当成「已装且最新」，使用者反而看不到安装按钮）。
      // 响应里没有 installed 字段（旧服务端 / 契约不完整的 mock）→ 保持旧行为（按 installedVersion 认已装）。
      const installedExplicitFalse = Boolean(r && r.installed === false)
      const installedVersion = (!installedExplicitFalse && r)
        ? firstText(r.installedVersion, typeof r.installed === 'string' ? r.installed : '')
        : ''
      const hasInstalled = installedFlag || installedVersion !== ''
      // dirPresent = 目录在但没登记（卸载残留）；residual 时**照常提供安装按钮**（状态强制「可安装」）
      const dirPresent = Boolean(r && r.dirPresent === true)
      const registered = Boolean(r && r.registered === true)
      const bundleHit = Boolean(r && r.bundleHit === true)
      const residual = dirPresent && !hasInstalled
      const installed = installedVersion || (hasInstalled ? '—' : '')
      const mode = modeKey(r && (r.mode || r.installMode || r.installKind))
      const status = r ? (residual ? 'installable' : pluginStatus(r, hasInstalled, installedVersion, builtin)) : ''
      return {
        id: id, name: name, nature: nature, builtin: builtin, installed: installed,
        mode: mode, status: status,
        registered: registered, bundleHit: bundleHit, dirPresent: dirPresent, residual: residual,
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

    /**
     * 需要**读响应体**的写请求（1.1.3 T4 执行链）：基址分档与 postJson 相同，但不把
     * 4xx / 5xx 当传输异常 —— 宿主的 400 / 403 / 503 都带可读中文（error / message），
     * 必须原样回显（例如 503 = profile 未提供模型服务）。返回 { ok, status, body }。
     */
    function postFull(sub, body, timeoutMs) {
      return requestJsonFull(sub, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body || {}),
      }, timeoutMs || 15 * 60 * 1000)
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
      // 1.1.3：页签 5 → 4（安装与检查 / 核心配置 / 配置 / 关于与致谢）。
      // 原「安装子插件」并入「安装与检查」的子插件分组；原「初始化」由「核心配置」承接。
      const items = [
        ['install', t('tabInstall')],
        ['core', t('tabCore')],
        ['config', t('tabConfig')],
        ['about', t('tabAbout')],
      ]
      return h('div', { style: S.tabs }, items.map((it) =>
        h('button', {
          key: it[0], type: 'button', style: S.tab(props.tab === it[0]),
          'data-tab': it[0],
          onClick: () => props.setTab(it[0]),
        }, it[1])))
    }

    /**
     * 环境依赖分组的一行（1.1.3，**只读**）：名称 · 状态徽标 · 证据值 · 说明。
     * 与「依赖安装工具」里的 EnvRow 分开：本组只呈现探针结果，不带复选框与命令。
     */
    function DepRow(props) {
      const t = props.t
      const item = props.item
      if (!item) return null
      // 可选件（Obsidian）未就绪时用「可选」措辞 + 中性徽标，不当故障显示（返工 R-1）
      const optional = item.optional === true && item.status !== 'ok'
      const nodes = [
        h('div', { key: 'head', style: S.rowHead }, [
          h('span', { key: 'nm', style: S.itemName }, item.name),
          optional
            ? h('span', { key: 'st', style: Object.assign({}, S.badge, S.badgeSkip) }, t('statusOptional'))
            : h('span', { key: 'st', style: Object.assign({}, S.badge, statusStyle(item.status)) }, statusLabel(t, item.status)),
          h('span', { key: 'vl', style: S.itemValue }, String(item.value || '—')),
        ]),
      ]
      if (item.detail) nodes.push(h('div', { key: 'dt', style: S.itemDetail }, renderDetail(item.detail)))
      return h('div', { style: S.row }, nodes)
    }

    /**
     * 子插件分组的一行（1.1.3，**只读**）：id · 中文名 · 三态徽标 · 已装/内置版本。
     * 状态沿用既有三态文案（已是最新 / 可安装 / 可更新），接口没给状态时按「未检测」。
     */
    function PluginListRow(props) {
      const t = props.t
      const item = props.item
      const meta = PLUGIN_META[item.id] || {}
      const nameKey = meta.nameKey
      const nameText = (nameKey && t(nameKey) !== nameKey) ? t(nameKey) : ''
      const statusKey = PLUG_STATUS_KEYS[item.status]
      const stateStyle = item.status === 'upToDate' ? S.badgeOk : (item.status ? S.badgeWarn : S.badgeSkip)
      const versionText = item.installed || item.builtin || t('notInstalled')
      return h('div', { style: S.row }, [
        h('div', { key: 'head', style: S.rowHead }, [
          h('span', { key: 'id', style: S.itemName }, item.id),
          nameText ? h('span', { key: 'nm', style: S.actionHint }, nameText) : null,
          h('span', { key: 'st', style: Object.assign({}, S.badge, stateStyle) }, statusKey ? t(statusKey) : t('cfgDocSkillUnknown')),
          h('span', { key: 'vl', style: S.itemValue }, versionText),
        ]),
      ])
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
     * 说明页提示文案：ok = 已交给系统打开（附文件路径）；fail = 可读失败原因（附 code）。
     */
    function openHintText(t, hint) {
      const h = hint || {}
      if (h.phase === 'ok') return t('docOpened')
      const msg = String(h.message || '')
      const code = h.code ? '（' + h.code + '）' : ''
      return t('docOpenFailed') + '：' + msg + code
    }

    /**
     * 「安装与检查」页。
     * 生命周期：首次进入自动 GET /check（loading → ready / error）；
     * 单项「补齐」→ POST /fix { id }；底部主按钮 → POST /fix-all { ids }（串行），
     * 完成后自动重新检测。客户端从不发送命令字符串。
     */
    function InstallPage(props) {
      const t = props.t
      // 环境检测结果由 Section 统一持有（D1：只发一次 /check），本页只读取与请求刷新
      const check = props.check || { phase: 'ready', items: [], checkedAt: '', error: '' }
      const state = useState({
        picked: {}, fixingId: '', batch: null, copyState: null,
        // 1.1.3：子插件分组（GET /plugins）；失败时降级用 /check 的 subPlugins 探针兜底
        plugPhase: 'loading', plugItems: [], plugError: '',
        // 说明页：/docs 的存在性、/open-doc 的进行中标记与结果提示
        docs: { phase: 'loading', map: {}, error: '' },
        docBusy: '',
        openHint: null,
      })
      const st = state[0]
      const setSt = state[1]

      /** 子插件清单（GET /plugins，只读）：失败不阻塞页面，子插件组降级用 subPlugins 探针 */
      async function detectPlugins() {
        setSt((prev) => Object.assign({}, prev, { plugPhase: 'loading', plugError: '' }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const body = await getJson('/plugins', 15000)
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          if (body.ok === false) throw new Error(String(body.error || 'plugins 返回 ok:false'))
          setSt((prev) => Object.assign({}, prev, { plugPhase: 'ready', plugError: '', plugItems: pluginList(body) }))
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, { plugPhase: 'error', plugError: String((err && err.message) || err) }))
        }
      }

      /** 「重新检测」= 刷新共享的环境检测（父级那份）+ 本页的子插件清单与说明页文件存在性 */
      async function recheck() {
        setSt((prev) => Object.assign({}, prev, { batch: null, copyState: null, picked: {} }))
        await Promise.all([props.onRefreshCheck(), detectPlugins(), detectDocs()])
      }

      /**
       * 打开说明页（guide / help）：**交给宿主打开插件目录里的那个 HTML 文件**。
       * POST /open-doc { doc } → 200 { ok, doc, path, command }；失败 { ok:false, error, code }。
       * 客户端不做导航、不取内容、不碰凭据；成功时只回显一下文件路径。
       */
      function openDoc(kind) {
        if (DOC_IDS.indexOf(kind) < 0) return
        setSt((prev) => Object.assign({}, prev, { docBusy: kind, openHint: null }))
        postFull('/open-doc', { doc: kind }, 60000).then((res) => {
          const body = (res && res.body && typeof res.body === 'object') ? res.body : {}
          if (!res.ok || body.ok === false) {
            setSt((prev) => Object.assign({}, prev, {
              docBusy: '',
              openHint: {
                kind: kind, phase: 'fail', path: typeof body.path === 'string' ? body.path : '',
                message: String(body.error || body.message || ('HTTP ' + res.status)),
                code: String(body.code || ''),
              },
            }))
            return
          }
          setSt((prev) => Object.assign({}, prev, {
            docBusy: '',
            openHint: { kind: kind, phase: 'ok', path: typeof body.path === 'string' ? body.path : '', message: '', code: '' },
          }))
        }, (err) => {
          setSt((prev) => Object.assign({}, prev, {
            docBusy: '',
            openHint: { kind: kind, phase: 'fail', path: '', message: String((err && err.message) || err), code: '' },
          }))
        })
      }

      /**
       * 两个说明页文件的存在性（只读；可选能力）：GET /docs → { ok, items:[{ doc, path, exists }] }。
       * 接口不可用时按「未知」处理，**不拦主流程**（按钮照常可点，失败原因由 /open-doc 给出）。
       */
      async function detectDocs() {
        setSt((prev) => Object.assign({}, prev, { docs: Object.assign({}, prev.docs, { phase: 'loading', error: '' }) }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const body = await getJson('/docs', 15000)
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          if (body.ok === false) throw new Error(String(body.error || 'docs 返回 ok:false'))
          const map = {}
          for (const it of (Array.isArray(body.items) ? body.items : [])) {
            if (it && typeof it.doc === 'string') {
              map[it.doc] = { path: typeof it.path === 'string' ? it.path : '', exists: it.exists === true }
            }
          }
          setSt((prev) => Object.assign({}, prev, { docs: { phase: 'ready', map: map, error: '' } }))
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, {
            docs: { phase: 'error', map: {}, error: String((err && err.message) || err) },
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
        await props.onRefreshCheck()
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
        await props.onRefreshCheck()
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
          // 环境清单现在来自父级共享的 check（D1），勾选默认值也读它
          const found = (check.items || []).filter((x) => x && x.id === id)[0]
          const def = Boolean(found && found.autoFixable === true)
          const cur = prev.picked[id] !== undefined ? prev.picked[id] : def
          const next = Object.assign({}, prev.picked)
          next[id] = !cur
          return Object.assign({}, prev, { picked: next })
        })
      }

      useEffect(() => { detectPlugins(); detectDocs() }, [])

      const byId = {}
      for (const it of (check.items || [])) { if (it && it.id) byId[it.id] = it }
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
      const loading = check.phase === 'loading'
      const emptyList = check.phase === 'ready' && (!check.items || check.items.length === 0)
      const batchRunning = Boolean(st.batch && st.batch.running)
      const busy = batchRunning || st.fixingId !== ''
      const fixableIds = rows.filter((r) => r.autoFixable).map((r) => r.id)
      const pickedIds = fixableIds.filter((id) => (st.picked[id] !== undefined ? st.picked[id] : true))
      // ── 1.1.3 分组派生量（设计定稿 §2） ────────────────────────────
      // 环境依赖：六项；「正常」= status ok（warn / missing / skip 都算待处理）
      const depRows = DEP_ITEM_IDS.map((id) => {
        const row = rows.filter((r) => r.id === id)[0]
        return row ? Object.assign({}, row, { optional: DEP_OPTIONAL_IDS.indexOf(id) >= 0 }) : row
      }).filter(Boolean)
      const depOkCount = depRows.filter((r) => r.status === 'ok').length
      // 主按钮只数**硬项**（返工 R-1）：可选件未装不算「待处理」；徽标仍如实显示 N/6
      const depPending = DEP_REQUIRED_IDS.filter((id) => {
        const row = depRows.filter((r) => r.id === id)[0]
        return !row || row.status !== 'ok'
      }).length
      // 依赖安装工具：只列可代执行 / 可给命令的四项（FIX_ORDER 固定顺序）
      const fixRows = FIX_ORDER.map((id) => rows.filter((r) => r.id === id)[0]).filter(Boolean)
      // 子插件：/plugins 就绪时按清单渲染；不可达时降级用 subPlugins 探针（/check 的第 7 项）
      const plugById = {}
      for (const raw of (st.plugPhase === 'ready' ? st.plugItems : [])) { if (raw && raw.id) plugById[raw.id] = raw }
      const plugRows = INSTALL_ORDER.map((id) => normalizePlugin(plugById[id] || null, id, t))
      const plugKnown = st.plugPhase === 'ready'
      const subPlugProbe = byId['subPlugins'] || null
      const plugOkCount = plugKnown
        ? plugRows.filter((r) => r.status === 'upToDate').length
        : (subPlugProbe && subPlugProbe.status === 'ok' ? INSTALL_ORDER.length : 0)
      // 清单不可达时：探针 ok → 0 项待处理；skip（读不到 profile）→ 不计；其余 → 至少 1 项
      const plugPending = plugKnown
        ? (INSTALL_ORDER.length - plugOkCount)
        : (subPlugProbe && subPlugProbe.status !== 'ok' && subPlugProbe.status !== 'skip' ? 1 : 0)
      // 说明页文件存在性（/docs 明确说 exists:false 才视为缺失；接口不可用按「未知」处理）
      const docState = (st.docs && typeof st.docs === 'object') ? st.docs : { phase: 'loading', map: {} }
      const docExists = (id) => {
        const it = docState.map ? docState.map[id] : null
        return !it || it.exists !== false
      }
      const missingDocs = DOC_IDS.filter((id) => !docExists(id)).map((id) => ({
        id: id,
        path: String((docState.map && docState.map[id] && docState.map[id].path) || ''),
      }))
      // 主按钮：依赖组（6）+ 子插件组（5）全部正常 → 置灰（文案「环境已就绪」）
      const pendingCount = depPending + plugPending
      const allReady = check.phase === 'ready' && pendingCount === 0
      const guideDisabled = loading || allReady
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
        // ① 置顶按钮组（设计定稿 §2：主按钮最显眼）。两个入口都请宿主打开随包 HTML 文件。
        h('div', { key: 'top', style: S.actionsTop }, [
          h('button', {
            key: 'guide', type: 'button',
            disabled: guideDisabled || !docExists('guide') || st.docBusy === 'guide',
            style: Object.assign({}, S.btn, S.btnPrimary,
              (guideDisabled || !docExists('guide') || st.docBusy === 'guide') ? S.btnDisabled : null),
            onClick: () => openDoc('guide'),
          }, allReady ? t('guideReady') : fill(t('guideOpen'), pendingCount)),
          h('button', {
            key: 'help', type: 'button',
            disabled: !docExists('help') || st.docBusy === 'help',
            style: Object.assign({}, S.btn, (!docExists('help') || st.docBusy === 'help') ? S.btnDisabled : null),
            onClick: () => openDoc('help'),
          }, t('helpOpen')),
        ]),
        // ② 检测元信息：检测时间 · 重新检测 · 只读声明
        h('div', { key: 'meta', style: S.metaNote }, [
          check.checkedAt ? (t('checkedAt') + ' ' + check.checkedAt + ' · ') : null,
          h('button', {
            key: 're', type: 'button', disabled: loading,
            style: Object.assign({}, S.metaLink, loading ? { opacity: 0.6, cursor: 'default' } : null),
            onClick: () => recheck(),
          }, loading ? t('checking') : t('recheck')),
          ' · ' + t('readOnlyNote'),
        ]),
        // ③ 说明页打开结果（成功回显文件路径；失败给可读原因 —— 都不静默）
        st.openHint ? h('div', { key: 'openhint', style: st.openHint.phase === 'ok' ? S.note : S.warnLine }, [
          h('div', { key: 'm' }, openHintText(t, st.openHint)),
          st.openHint.path ? h('code', { key: 'u', style: S.fixCmd }, String(st.openHint.path)) : null,
        ]) : null,
        // ③b 文件缺失（仅当 /docs 明确说 exists:false；对应按钮已置灰）
        missingDocs.length ? h('div', { key: 'docmiss', style: S.warnLine },
          [h('div', { key: 'm' }, t('docMissing'))].concat(
            missingDocs.map((d) => h('code', { key: d.id, style: S.fixCmd }, d.path || d.id)))) : null,
        // ④ 环境依赖（6 项，只读）
        h('div', { key: 'deps', style: S.card }, [
          h('div', { key: 'head', style: S.cardHead }, [
            h('h3', { key: 'title', style: S.cardTitle }, [
              t('depsGroupTitle'),
              loading ? badge(t('checking'), S.badgeWarn) : null,
              h('span', { key: 'cnt', style: S.groupCount }, badge(
                fillAll(t('depsCount'), { done: depOkCount, total: DEP_ITEM_IDS.length }),
                depOkCount === DEP_ITEM_IDS.length ? S.badgeOk : S.badgeWarn)),
            ]),
            h('div', { key: 'sub', style: S.cardSub }, t('depsGroupSub')),
          ]),
          h('div', { key: 'body', style: S.cardBody }, [
            check.phase === 'error' ? h('div', { key: 'err', style: S.error }, [
              h('div', { key: 't', style: S.errorTitle }, t('loadFailed')),
              h('div', { key: 'm', style: S.errorMsg }, check.error),
              h('div', { key: 'h', style: S.errorHint }, t('loadFailedHint')),
              h('button', {
                key: 'b', type: 'button',
                style: Object.assign({}, S.btn, S.btnPrimary),
                onClick: () => props.onRefreshCheck(),
              }, t('retry')),
            ]) : null,
            h('div', { key: 'list' }, depRows.map((item) => h(DepRow, { key: item.id, t: t, item: item }))),
            emptyList ? h('div', { key: 'empty', style: S.note }, t('emptyList')) : null,
          ]),
        ]),
        // ⑤ 依赖安装工具（位于环境依赖**下方**）：逐项 POST /fix，请求层失败才兜底 /fix-all。
        //    客户端只上报 id；命令与白名单全在宿主侧。
        h('div', { key: 'tool', style: S.card }, [
          h('div', { key: 'head', style: S.cardHead }, [
            h('h3', { key: 'title', style: S.cardTitle }, [
              t('fixToolTitle'),
              h('span', { key: 'cnt', style: S.groupCount }, badge(t('fixToolBadge'), S.badgeSkip)),
            ]),
            h('div', { key: 'sub', style: S.cardSub }, t('fixToolSub')),
          ]),
          h('div', { key: 'body', style: S.cardBody }, [
            h('div', { key: 'list' }, fixRows.map((item) => h(EnvRow, {
              key: item.id, t: t, item: item,
              picked: st.picked[item.id] !== undefined ? st.picked[item.id] : item.autoFixable,
              fixingId: st.fixingId, copyState: st.copyState, busy: busy,
              onFix: runFix, onCopy: copyCommand, onToggle: togglePick,
            }))),
            h('div', { key: 'act', style: S.actions }, [
              h('button', {
                key: 'batch', type: 'button',
                disabled: busy || pickedIds.length === 0,
                style: Object.assign({}, S.btn, S.btnPrimary, (busy || pickedIds.length === 0) ? S.btnDisabled : null),
                onClick: () => runBatch(pickedIds),
              }, busy
                ? [h('span', { key: 'sp', className: 'wps-spin', style: Object.assign({}, S.spinner, { animation: 'wpsSpin .9s linear infinite' }) }, '⟳'), progressText]
                : fill(t('fixSelected'), pickedIds.length)),
              h('span', { key: 'note', style: S.actionHint }, pickedIds.length ? (willInstall + ' · ' + t('batchHint')) : t('pickHint')),
            ]),
            h('div', { key: 'note2', style: S.note }, t('fixToolNote')),
          ]),
        ]),
        // ⑥ 子插件（吸收原「安装子插件」页的清单内容）
        h('div', { key: 'plugs', style: S.card }, [
          h('div', { key: 'head', style: S.cardHead }, [
            h('h3', { key: 'title', style: S.cardTitle }, [
              t('plugGroupTitle'),
              h('span', { key: 'cnt', style: S.groupCount }, badge(
                fillAll(t('plugGroupCount'), { done: plugOkCount, total: INSTALL_ORDER.length }),
                plugOkCount === INSTALL_ORDER.length ? S.badgeOk : S.badgeWarn)),
            ]),
            h('div', { key: 'sub', style: S.cardSub }, t('plugGroupSub')),
          ]),
          h('div', { key: 'body', style: S.cardBody }, [
            h('div', { key: 'list' }, plugRows.map((item) => h(PluginListRow, { key: item.id, t: t, item: item }))),
            !plugKnown ? h('div', { key: 'deg', style: S.note }, t('plugGroupUnavailable')) : null,
          ]),
        ]),
        st.batch ? h(FixReport, { key: 'fix', t: t, batch: st.batch, rows: rows }) : null,
        h('div', { key: 'foot', style: S.note }, t('footNote')),
      ])
    }

    /**
     * 门禁三项（设计定稿 §3.1）——与「安装与检查」页**同源**：都读同一份 GET /check 响应。
     * ① 记忆库插件 dsh-work-memory 已装（探针 detail 逐项列出「名字@版本 / 名字（未安装）」）
     * ② Python 解释器 ≥ 3.10（探针已按 MIN_PYTHON 判定，ok 即达标）
     * ③ Python 工具 8 个包齐全（pythonDeps 探针 ok）
     * **记忆库工作目录不在此列**：它就在本页填写，否则会死锁。
     */
    function gateRows(t, byId, pending) {
      const isLoading = Boolean(pending)
      const py = byId['python'] || null
      const pd = byId['pythonDeps'] || null
      const sp = byId['subPlugins'] || null
      const spDetail = sp ? String(sp.detail || '') : ''
      let memOk = false
      if (spDetail) {
        // detail 形如「dsh-work-memory@1.0.5、dsh-experts（未安装）」——只看记忆库那一项
        memOk = spDetail.indexOf('dsh-work-memory') >= 0
          && spDetail.indexOf('dsh-work-memory（未安装）') < 0
      } else if (sp) {
        memOk = sp.status === 'ok'
      }
      const pyOk = Boolean(py && py.status === 'ok')
      const pdOk = Boolean(pd && pd.status === 'ok')
      return [
        {
          id: 'memory', label: t('gateItemMemory'), ok: memOk, pending: isLoading,
          state: sp ? (memOk ? 'ok' : (sp.status === 'skip' ? 'skip' : 'missing')) : 'missing',
          value: 'dsh-work-memory',
        },
        {
          id: 'python', label: t('gateItemPython'), ok: pyOk, pending: isLoading,
          state: py ? py.status : 'missing',
          value: (py && py.value) ? py.value : t('gatePythonHint'),
        },
        {
          id: 'deps', label: t('gateItemDeps'), ok: pdOk, pending: isLoading,
          state: pd ? pd.status : 'missing',
          value: (pd && pd.value) ? pd.value : t('gateDepsHint'),
        },
      ]
    }

    /**
     * 执行链（客户端写死，逐步发请求）。顺序**必须**与宿主的唯一权威源一致：
     * `lib/basedeck.js` 的 `BASEDECK_APPLY_ORDER` =
     * dirs → migrateMemory → memorySeed → memoryDeck → knowledgeDeck → skills → settings → agentsMd。
     * 本链只取其中要跑的五步（dirs / memorySeed / skills / agentsMd 由别的入口负责）。
     *
     * ⚠️ **顺序有后果，别随手调换**：迁移是**逐文件只补缺失、目标已有同名文件一律保留目标不覆盖**
     * （`planMigrateMemory`）。若先跑 memoryDeck，它会先写出 MEMORY.md / USER.md / GRAPH.json /
     * PROJECTS/工作秘书.md，迁移随即把这四个判成「同名但内容不同」而**全部跳过** —— 旧库的身份、
     * 全局记忆、偏好与项目记忆一个都进不来。实测：目标为空时 copies=4；先建库后 copies=1 / conflicts=3。
     * 所以**必须先迁移、再由 memoryDeck 补缺失的骨架与占位**。（迁移的目标目录不需要预先存在：
     * `withMemoryDirLockAsync` 取锁前会 `mkdirSync(target, {recursive:true})`。）
     * 「检」是最前面的只读可用性检查（preflight），不属于 basedeck 的项。
     */
    const CORE_CHAIN = [
      { id: 'check', labelKey: 'chainStepCheck', subKey: 'chainStepCheckSub' },
      { id: 'migrateMemory', labelKey: 'chainStepMigrate', subKey: 'chainStepMigrateSub' },
      { id: 'memoryDeck', labelKey: 'chainStepMemory', subKey: 'chainStepMemorySub' },
      { id: 'knowledgeDeck', labelKey: 'chainStepKnowledge', subKey: 'chainStepKnowledgeSub' },
      { id: 'link', labelKey: 'chainStepLink', subKey: 'chainStepLinkSub' },
      { id: 'identity', labelKey: 'chainStepIdentity', subKey: 'chainStepIdentitySub' },
    ]
    /** 岗位下拉里「新建岗位…」的哨兵值（不是真实岗位 id） */
    const NEW_DOMAIN_VALUE = '__new__'
    /**
     * 新建岗位的字数上限（使用者 2026-09-16 裁定）：名称 ≤ 10 字，内容 ≤ 200 字。
     * 前端三层保证：输入框 maxLength → 变更时截断 → 保存前校验。
     */
    const DOMAIN_NAME_MAX = 10
    const DOMAIN_CONTENT_MAX = 200
    /** 知识库里的记忆镜像区目录名（与宿主 basedeck 的 VAULT_MIRROR_DIR_NAME 一致） */
    const VAULT_MIRROR_NAME = '00_全局记忆'

    /** 「核心配置」页的 state 默认骨架（形状兜底用） */
    const CORE_STATE_DEFAULT = {
      phase: 'loading', items: [], error: '',
      domains: { phase: 'loading', items: [], error: '', maxChars: 200 },
      memoryDir: '', obsidianDir: '', domainId: '', custom: [],
      modal: null, run: null, imported: '', pickError: '', openHint: null,
      // 当前生效值（GET /setup-state）：用于预填三个字段并标注来源；setupFilled = 已预填过
      setup: { phase: 'loading', data: null, error: '' }, setupFilled: false,
      // 应用内目录浏览器（方案 A）；null = 未打开。形状见 DIR_BROWSER_DEFAULT
      browse: null,
      // D3：三项全绿后由使用者点「点击此处继续」才展开配置表单
      gateConfirmed: false,
    }
    /**
     * 防御性归一：state 形状异常时（hook 替身槽位错位、热更中途等）退回默认骨架，
     * 保证读取与 setState 更新都不抛、页面不白屏。真机由 React 保证形状，这里是兜底。
     */
    function coreStateSafe(prev) {
      const base = Object.assign({}, CORE_STATE_DEFAULT, (prev && typeof prev === 'object') ? prev : {})
      if (!base.domains || typeof base.domains !== 'object') base.domains = CORE_STATE_DEFAULT.domains
      if (!Array.isArray(base.items)) base.items = []
      if (!Array.isArray(base.custom)) base.custom = []
      return base
    }

    /**
     * 「核心配置」页（1.1.3 T4：门禁 + 目录与岗位 + 保存即执行链 + 导入引导卡）。
     * 门禁：任一不满足 → 整页灰化（opacity + pointer-events:none）+ 门禁卡；
     * 三项就绪 → 显示「点击此处继续」，由使用者点击后进入配置表单。
     * 执行链：可用性检查 → 建立记忆库目录 → 建立知识库目录 → 建立两者关联 → 写入岗位身份；
     * 任一步失败停在该步并可重试（已完成的部分保留，重复执行只补缺失）。
     */
    function CorePage(props) {
      const t = props.t
      // 环境检测结果来自 Section（D1：与安装与检查页共用同一份，本页不再自己发 /check）
      const check = props.check || { phase: 'ready', items: [], checkedAt: '', error: '' }
      const state = useState(Object.assign({}, CORE_STATE_DEFAULT))
      const st = coreStateSafe(state[0])
      const setRaw = state[1]
      // 所有更新都经 coreStateSafe 归一：prev 形状不对也能安全合并
      const setSt = (updater) => setRaw((prev) => {
        const base = coreStateSafe(prev)
        const next = (typeof updater === 'function') ? updater(base) : Object.assign({}, base, updater)
        return coreStateSafe(next)
      })

      async function loadDomains() {
        setSt((prev) => Object.assign({}, prev, { domains: Object.assign({}, prev.domains, { phase: 'loading', error: '' }) }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const body = await getJson('/domain/list', 15000)
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          if (body.ok === false) throw new Error(String(body.error || 'domain/list 返回 ok:false'))
          setSt((prev) => Object.assign({}, prev, {
            domains: {
              phase: 'ready', error: '',
              items: Array.isArray(body.items) ? body.items : [],
              maxChars: (typeof body.maxChars === 'number' && isFinite(body.maxChars)) ? body.maxChars : 200,
            },
          }))
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, {
            domains: Object.assign({}, prev.domains, { phase: 'error', error: String((err && err.message) || err) }),
          }))
        }
      }

      /**
       * 当前生效值（只读）：GET /setup-state → { memoryDir:{value,source}, obsidianDir:{value,source},
       * domain:{id,label,isPreset,source}, identity:{...}, note }。
       * 用途：进入页面时**预填**三个字段并标注来源；**绝不**因此触发任何写操作。
       * 预填只在字段仍为空时进行（不覆盖使用者已输入的内容）；接口不可用时不拦主流程。
       */
      async function loadSetupState() {
        setSt((prev) => Object.assign({}, prev, { setup: Object.assign({}, prev.setup, { phase: 'loading', error: '' }) }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const body = await getJson('/setup-state', 15000)
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          if (body.ok === false) throw new Error(String(body.error || 'setup-state 返回 ok:false'))
          const mem = (body.memoryDir && typeof body.memoryDir === 'object') ? body.memoryDir : {}
          const obs = (body.obsidianDir && typeof body.obsidianDir === 'object') ? body.obsidianDir : {}
          const dom = (body.domain && typeof body.domain === 'object') ? body.domain : {}
          setSt((prev) => {
            // 只在**首次**取到生效值时预填：之后（重新检测 / 使用者清空后）不再回填，
            // 否则「清空字段」会被下一次取数悄悄撤销。用独立标记 setupFilled，
            // 避免被 loading 态（会覆盖 setup.phase）影响判断。
            const alreadyFilled = prev.setupFilled === true
            const next = { setup: { phase: 'ready', data: body, error: '' }, setupFilled: true }
            if (!alreadyFilled && !String(prev.memoryDir || '').trim() && typeof mem.value === 'string' && mem.value.trim()) {
              next.memoryDir = mem.value.trim()
            }
            if (!alreadyFilled && !String(prev.obsidianDir || '').trim() && typeof obs.value === 'string' && obs.value.trim()) {
              next.obsidianDir = obs.value.trim()
            }
            if (!alreadyFilled && !String(prev.domainId || '').trim() && typeof dom.id === 'string' && dom.id) {
              if (dom.isPreset === true) {
                // 预置岗位：直接选中对应项（正文来自 /domain/list）
                next.domainId = dom.id
              } else {
                // 非预置岗位：走「都不是（新建岗位…）」——把当前岗位名带进自定义岗位，
                // 正文留空（身份正文不能凭空造），保存前需使用者补写或点「自动生成」。
                const label = (typeof dom.label === 'string' && dom.label.trim()) ? dom.label.trim() : dom.id
                const id = 'custom:' + label
                next.custom = (Array.isArray(prev.custom) ? prev.custom : [])
                  .filter((d) => d && d.id !== id)
                  .concat([{ id: id, label: label + t('modalCustomSuffix'), content: '' }])
                next.domainId = id
              }
            }
            return Object.assign({}, prev, next)
          })
        } catch (err) {
          setSt((prev) => Object.assign({}, prev, {
            setup: { phase: 'error', data: null, error: String((err && err.message) || err) },
          }))
        }
      }

      useEffect(() => { loadDomains(); loadSetupState() }, [])

      // ── 表单（记忆库目录 → Obsidian 目录 → 工作岗位） ──────────────
      function setField(key, value) {
        setSt((prev) => Object.assign({}, prev, { [key]: value }))
      }
      function setPickError(msg) {
        setSt((prev) => Object.assign({}, prev, { pickError: String(msg || '') }))
      }
      // ── 目录选择：native 优先，native 不可用时转应用内浏览器（方案 A）──
      const browseSt = Object.assign({}, DIR_BROWSER_DEFAULT, st.browse || {})

      function browseLoad(path) {
        setSt((prev) => Object.assign({}, prev, {
          browse: Object.assign({}, DIR_BROWSER_DEFAULT, prev.browse || {}, { phase: 'loading', error: '', newError: '' }),
        }))
        dirBrowserLoad(path).then((patch) => {
          setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, patch) }))
        }).catch((err) => {
          setSt((prev) => Object.assign({}, prev, {
            browse: Object.assign({}, prev.browse, { phase: 'error', error: dirBrowserErrorText(t, err) }),
          }))
        })
      }
      /** 打开应用内浏览器：起始路径用输入框已有值，否则交给宿主给默认起点（前端不硬编码盘符） */
      function openDirBrowser(target) {
        setSt((prev) => Object.assign({}, prev, {
          browse: Object.assign({}, DIR_BROWSER_DEFAULT, { open: true, phase: 'loading', target: target }),
          pickError: '',
        }))
        const start = target && target.key ? String(st[target.key] || '').trim() : ''
        dirBrowserLoad(start).then((patch) => {
          setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, patch) }))
        }).catch((err) => {
          setSt((prev) => Object.assign({}, prev, {
            browse: Object.assign({}, prev.browse, { phase: 'error', error: dirBrowserErrorText(t, err) }),
          }))
        })
      }
      function browsePick() {
        const target = (browseSt.target && typeof browseSt.target === 'object') ? browseSt.target : {}
        const path = String(browseSt.path || '')
        if (!path) return
        if (target.key) setField(target.key, path)
        if (target.import) setSt((prev) => Object.assign({}, prev, { imported: path, browse: null }))
        else setSt((prev) => Object.assign({}, prev, { browse: null }))
        setPickError('')
      }
      function browseCancel() { setSt((prev) => Object.assign({}, prev, { browse: null })) }
      function browseNewName(v) {
        setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, { newName: String(v || '') }) }))
      }
      function browseNew() {
        const parent = String(browseSt.path || '')
        const name = String(browseSt.newName || '').trim()
        if (!name) {
          setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, { newError: t('dirBrowserNewNameRequired') }) }))
          return
        }
        setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, { newPhase: 'run', newError: '' }) }))
        postFull('/dirs/new', { path: parent, name: name }, 60000).then((res) => {
          const body = (res && res.body && typeof res.body === 'object') ? res.body : {}
          if (!res.ok || body.ok === false) {
            setSt((prev) => Object.assign({}, prev, {
              browse: Object.assign({}, prev.browse, {
                newPhase: 'idle',
                newError: t('dirBrowserNewFailed') + '：' + String(body.message || body.error || ('HTTP ' + res.status)),
              }),
            }))
            return
          }
          setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, { newPhase: 'idle', newName: '', newError: '' }) }))
          browseLoad(String(body.path || parent))
        }, (err) => {
          setSt((prev) => Object.assign({}, prev, {
            browse: Object.assign({}, prev.browse, { newPhase: 'idle', newError: t('dirBrowserNewFailed') + '：' + String((err && err.message) || err) }),
          }))
        })
      }

      /** native 优先（桌面壳 bridge → uiWorkspace）；native 能力缺失时转应用内浏览器 */
      function pickDir(key) {
        const fn = props.pickDirectory
        if (typeof fn !== 'function') { openDirBrowser({ key: key }); return }
        setPickError('')
        Promise.resolve().then(() => fn()).then((dir) => {
          if (typeof dir === 'string' && dir.trim()) setField(key, dir.trim())
        }).catch((err) => {
          const msg = String((err && err.message) || err)
          if (msg.indexOf('native capability') >= 0 || msg.indexOf('系统目录选择器') >= 0) { openDirBrowser({ key: key }); return }
          setPickError(t('initPickFailed') + msg)
        })
      }
      function pickImport() {
        const fn = props.pickDirectory
        if (typeof fn !== 'function') { openDirBrowser({ import: true }); return }
        setPickError('')
        Promise.resolve().then(() => fn()).then((dir) => {
          if (typeof dir === 'string' && dir.trim()) setSt((prev) => Object.assign({}, prev, { imported: dir.trim() }))
        }).catch((err) => {
          const msg = String((err && err.message) || err)
          if (msg.indexOf('native capability') >= 0 || msg.indexOf('系统目录选择器') >= 0) { openDirBrowser({ import: true }); return }
          setPickError(t('initPickFailed') + msg)
        })
      }

      // 岗位选项：预置取自 GET /domain/list（不在前端写死第二份正文）+ 本页新建的自定义岗位
      const domainOptions = (Array.isArray(st.domains.items) ? st.domains.items : [])
        .map((d) => ({ id: String(d && d.id || ''), label: String(d && d.label || ''), content: String(d && d.content || '') }))
        .filter((d) => d.id)
        .concat(st.custom)
      const selectedDomain = domainOptions.filter((d) => d.id === st.domainId)[0] || null
      const domainContent = selectedDomain ? String(selectedDomain.content || '') : ''
      const memoryDir = String(st.memoryDir || '').trim()
      const obsidianDir = String(st.obsidianDir || '').trim()
      const filledCount = (memoryDir ? 1 : 0) + (obsidianDir ? 1 : 0) + (domainContent.trim() ? 1 : 0)
      const runPhase = st.run ? st.run.phase : 'idle'
      const runRunning = runPhase === 'run'
      const canSave = filledCount === 3 && !runRunning

      function onDomainChange(value) {
        if (value === NEW_DOMAIN_VALUE) {
          setSt((prev) => Object.assign({}, prev, { modal: { name: '', content: '', phase: 'idle', message: '', error: '' } }))
          return
        }
        setField('domainId', value)
      }

      // ── 新建岗位对话框 ────────────────────────────────────────────
      function setModal(patch) {
        setSt((prev) => (prev.modal ? Object.assign({}, prev, { modal: Object.assign({}, prev.modal, patch) }) : prev))
      }
      function closeModal() {
        setSt((prev) => Object.assign({}, prev, { modal: null }))
      }
      /**
       * [自动生成] → POST /domain/generate（显式触发；结果只作预览）。
       * 503（profile 未提供模型服务）→ 明确改成手填并说明原因，绝不假成功。
       */
      async function generateDomain() {
        if (!st.modal || st.modal.phase === 'run') return
        const name = String(st.modal.name || '').trim()
        const draft = String(st.modal.content || '').trim()
        setModal({ phase: 'run', message: t('modalGenRunning'), error: '' })
        try {
          const res = await postFull('/domain/generate', { name: name, content: draft }, 120000)
          const body = (res && res.body && typeof res.body === 'object') ? res.body : {}
          if (res.status === 503 || body.code === 'no-model-service') {
            setModal({ phase: 'idle', message: '', error: String(body.error || t('modalGenNoModel')) })
            return
          }
          if (!res.ok || body.ok === false) {
            setModal({ phase: 'idle', message: '', error: t('modalGenFailed') + '：' + String(body.error || body.message || ('HTTP ' + res.status)) })
            return
          }
          // 二次兜底：服务端已按字数截断，这里再截一次（改用者手改接口 / 口径变化时不溢出）
          setModal({ phase: 'idle', content: String(body.content || '').slice(0, DOMAIN_CONTENT_MAX), message: t('modalGenDone'), error: '' })
        } catch (err) {
          setModal({ phase: 'idle', message: '', error: t('modalGenFailed') + '：' + String((err && err.message) || err) })
        }
      }
      function saveModal() {
        if (!st.modal) return
        const name = String(st.modal.name || '').trim()
        const content = String(st.modal.content || '').trim()
        if (!name) { setModal({ error: t('modalNameRequired') }); return }
        if (name.length > DOMAIN_NAME_MAX) { setModal({ error: fill(t('modalNameOver'), DOMAIN_NAME_MAX) }); return }
        if (content.length > DOMAIN_CONTENT_MAX) { setModal({ error: fill(t('modalOver'), DOMAIN_CONTENT_MAX) }); return }
        const id = 'custom:' + name
        setSt((prev) => Object.assign({}, prev, {
          custom: prev.custom.filter((d) => d.id !== id).concat([{ id: id, label: name + t('modalCustomSuffix'), content: content }]),
          domainId: id,
          modal: null,
        }))
      }

      // ── 保存即执行链 ──────────────────────────────────────────────
      function chainInit() {
        return CORE_CHAIN.map((s, i) => ({ id: s.id, index: i, state: 'wait', detail: '', error: '' }))
      }
      function setStep(index, patch) {
        setSt((prev) => {
          const run = prev.run || { phase: 'idle', steps: chainInit(), failedAt: -1 }
          const steps = run.steps.map((s, i) => (i === index ? Object.assign({}, s, patch) : s))
          return Object.assign({}, prev, { run: Object.assign({}, run, { steps: steps }) })
        })
      }
      /**
       * 逐步执行（幂等）：从 from 步开始，把该步及其后复位为等待，已成功的保留。
       * 任一步失败 → 停在该步（不整链回滚），run.failedAt 记录位置供 [重试]。
       */
      async function runChain(from) {
        if (st.run && st.run.phase === 'run') return
        const start = (typeof from === 'number' && from >= 0) ? from : 0
        const base = (st.run && Array.isArray(st.run.steps)) ? st.run.steps : chainInit()
        const reset = base.map((s, i) => (i >= start ? Object.assign({}, s, { state: 'wait', detail: '', error: '' }) : s))
        setSt((prev) => Object.assign({}, prev, { run: { phase: 'run', steps: reset, failedAt: -1 } }))
        const form = { memoryDir: memoryDir, obsidianDir: obsidianDir, content: domainContent.trim() }
        for (let i = start; i < CORE_CHAIN.length; i++) {
          setStep(i, { state: 'run', detail: '', error: '' })
          try {
            const detail = await runChainStep(CORE_CHAIN[i].id, form)
            setStep(i, { state: 'ok', detail: detail })
          } catch (err) {
            setStep(i, { state: 'fail', detail: '', error: String((err && err.message) || err) })
            setSt((prev) => Object.assign({}, prev, { run: Object.assign({}, prev.run, { phase: 'fail', failedAt: i }) }))
            return
          }
        }
        setSt((prev) => Object.assign({}, prev, { run: Object.assign({}, prev.run, { phase: 'done', failedAt: -1 }) }))
      }

      /** 单步实现：每一步都显式 dryRun:false；可用性检查是只读的，不传 dryRun */
      async function runChainStep(id, form) {
        if (id === 'check') {
          const res = await postFull('/preflight', { memoryDir: form.memoryDir, obsidianDir: form.obsidianDir, workspace: '' }, 60000)
          const body = (res && res.body && typeof res.body === 'object') ? res.body : {}
          if (!res.ok || body.ok === false) throw new Error(String(body.error || body.message || ('HTTP ' + res.status)))
          const checks = Array.isArray(body.checks) ? body.checks : []
          const blocked = checks.filter((c) => c && c.level === 'block')
          if (body.ready !== true || blocked.length) {
            throw new Error(blocked.length
              ? blocked.map((c) => String(c.label || c.id || '') + '：' + String(c.detail || '')).join('；')
              : t('chainStepCheck'))
          }
          // 提示项（warn：跨盘 / 两目录相同或嵌套）**必须带出来**：它们是提示而不是拦截，
          // 但藏在「检查通过」后面等于没说，使用者就无从判断自己要不要改。
          const warned = checks.filter((c) => c && c.level === 'warn')
          return t('chainStepCheckSub') + (warned.length
            ? '｜' + t('chainStepCheckWarn') + warned.map((c) => String(c.detail || c.label || '')).join('；')
            : '')
        }
        if (id === 'memoryDeck' || id === 'knowledgeDeck') {
          const res = await postFull('/basedeck', {
            ids: [id],
            dryRun: false,
            overrides: { memoryDir: form.memoryDir, obsidianDir: form.obsidianDir },
          })
          return basedeckStepDetail(res, id)
        }
        if (id === 'migrateMemory') {
          // 先只读探一次：GET /basedeck 顶层带 migrateFrom（旧记忆库绝对路径）。
          // 没有旧目录、或旧目录与目标相同 → 本步显示「无需迁移」，**不发任何写请求**。
          const plan = await getJson('/basedeck', 20000)
          const from = (plan && typeof plan.migrateFrom === 'string') ? plan.migrateFrom.trim() : ''
          if (!from || from === form.memoryDir) return t('chainStepMigrateNone')
          const res = await postFull('/basedeck', {
            ids: ['migrateMemory'],
            dryRun: false,
            overrides: { memoryDir: form.memoryDir, obsidianDir: form.obsidianDir },
          })
          await basedeckStepDetail(res, 'migrateMemory')
          const body = (res && res.body && typeof res.body === 'object') ? res.body : {}
          const item = (Array.isArray(body.results) ? body.results : [])
            .filter((x) => x && x.id === 'migrateMemory')[0] || {}
          const stats = (item.migrateStats && typeof item.migrateStats === 'object') ? item.migrateStats : {}
          const copied = (typeof stats.copy === 'number') ? stats.copy
            : (Array.isArray(item.migratedFiles) ? item.migratedFiles.length : 0)
          const conflict = (typeof stats.conflict === 'number') ? stats.conflict
            : (Array.isArray(item.conflicts) ? item.conflicts.length : 0)
          const base = fillAll(t('chainStepMigrateDone'), { n: copied, conflict: conflict })
          return item.oldDirKept === false ? base : (base + ' · ' + t('chainStepMigrateKept'))
        }
        if (id === 'link') {
          // 第 3 步「建立两者关联」= 写 settings.yaml 的 work-memory.memoryDir 与
          // work-memory.obsidianSyncDir（后者 = <Obsidian 目录>/00_全局记忆）。
          // 走 basedeck 的 settings 项：lib/basedeck.js 的 planSettings 用
          // overrides.memoryDir / overrides.obsidianSyncDir 覆盖这两键（basedeck.js:1331-1333）。
          const mirror = form.obsidianDir.replace(/[\\/]+$/, '') + '/' + VAULT_MIRROR_NAME
          const res = await postFull('/basedeck', {
            ids: ['settings'],
            dryRun: false,
            overrides: { memoryDir: form.memoryDir, obsidianSyncDir: mirror, obsidianDir: form.obsidianDir },
          })
          await basedeckStepDetail(res, 'settings')
          return 'memoryDir = ' + form.memoryDir + ' · obsidianSyncDir = ' + mirror
        }
        if (id === 'identity') {
          const res = await postFull('/identity/save', {
            content: form.content,
            memoryDir: form.memoryDir,
            dryRun: false,
          })
          const body = (res && res.body && typeof res.body === 'object') ? res.body : {}
          if (!res.ok || body.ok === false) throw new Error(String(body.error || body.message || ('HTTP ' + res.status)))
          if (body.dryRun === true) throw new Error(t('initWriteDryRun'))
          return String(body.detail || body.entryAfter || body.status || '')
        }
        throw new Error('未知执行步：' + id)
      }

      /** 解析 POST /basedeck 单项结果（可读 detail；dryRun:true 视为未写盘） */
      async function basedeckStepDetail(res, id) {
        const body = (res && res.body && typeof res.body === 'object') ? res.body : {}
        if (!res.ok || body.ok === false) throw new Error(String(body.error || body.message || ('HTTP ' + res.status)))
        // 宿主「失败即停」：stoppedAt 非空说明它在某一步停了（后续项一律没跑）——
        // 立即抛错终止链条，runChain 会停在该步并给「重试」，绝不再发后续请求。
        if (typeof body.stoppedAt === 'string' && body.stoppedAt) {
          throw new Error(fillAll(t('chainStopped'), {
            step: String(body.stoppedAt),
            reason: String(body.stopReason || body.message || ''),
          }))
        }
        const item = (Array.isArray(body.results) ? body.results : []).filter((x) => x && x.id === id)[0] || null
        if (!item) throw new Error('响应里没有 ' + id + ' 的结果')
        if (item.ok === false) throw new Error(String(item.error || item.detail || '写入未成功'))
        if (body.dryRun === true || item.dryRun === true) throw new Error(t('initWriteDryRun'))
        return String(item.action || item.target || item.detail || '')
      }

      const byId = {}
      for (const it of (check.items || [])) { if (it && it.id) byId[it.id] = it }
      const rows = gateRows(t, byId, check.phase !== 'ready')
      const checkReady = check.phase === 'ready'
      const allGateOk = checkReady && rows.every((r) => r.ok)
      // D3：三项全绿后不再无声自动解锁，改由使用者点「点击此处继续」进入表单
      const gateConfirmed = st.gateConfirmed === true
      const gated = !checkReady || !allGateOk || !gateConfirmed
      const gateState = !checkReady
        ? (check.phase === 'error' ? t('gateLoadFailed') : t('gateChecking'))
        : (allGateOk ? t('gateReady') : t('gatePending'))
      const gateBadgeStyle = (checkReady && allGateOk) ? S.badgeOk : S.badgeWarn

      const gateCard = h('div', { key: 'gate', style: Object.assign({}, S.card, S.gateCard) }, [
        h('div', { key: 'head', style: S.cardHead }, [
          h('h3', { key: 'title', style: S.cardTitle }, [
            t('gateTitle'),
            h('span', { key: 'cnt', style: S.groupCount }, badge(gateState, gateBadgeStyle)),
          ]),
          h('div', { key: 'sub', style: S.cardSub }, t('gateSub')),
        ]),
        h('div', { key: 'body', style: S.cardBody }, [
          check.phase === 'error' ? h('div', { key: 'err', style: S.error }, [
            h('div', { key: 't', style: S.errorTitle }, t('loadFailed')),
            h('div', { key: 'm', style: S.errorMsg }, check.error),
            h('div', { key: 'h', style: S.errorHint }, t('loadFailedHint')),
            h('button', {
              key: 'b', type: 'button',
              style: Object.assign({}, S.btn, S.btnPrimary),
              onClick: () => props.onRefreshCheck(),
            }, t('retry')),
          ]) : null,
          h('div', { key: 'list' }, rows.map((r) => h('div', { key: r.id, style: S.row }, [
            h('div', { key: 'head', style: S.rowHead }, [
              h('span', { key: 'nm', style: S.itemName }, r.label),
              // D2：结果没到手之前显示「检测中…」，绝不把「未知」画成「缺失」
              r.pending
                ? h('span', { key: 'st', style: Object.assign({}, S.badge, S.badgeSkip) }, t('gateChecking'))
                : h('span', { key: 'st', style: Object.assign({}, S.badge, statusStyle(r.state)) }, statusLabel(t, r.state)),
              h('span', { key: 'vl', style: S.itemValue }, String(r.value || '—')),
            ]),
          ]))),
          h('div', { key: 'act', style: S.actions }, [
            (!checkReady || !allGateOk)
              ? h('button', {
                key: 'go', type: 'button',
                style: Object.assign({}, S.btn, S.btnPrimary),
                onClick: () => { if (typeof props.onGoInstall === 'function') props.onGoInstall() },
              }, t('gateGo'))
              : (gateConfirmed ? null : h('button', {
                key: 'cont', type: 'button',
                style: Object.assign({}, S.btn, S.btnPrimary),
                onClick: () => setSt((prev) => Object.assign({}, prev, { gateConfirmed: true })),
              }, t('gateContinue'))),
          ]),
          h('div', { key: 'note', style: S.note }, t('gateNote')),
        ]),
      ])

      // ── 渲染：目录与岗位（顺序：记忆库目录 → Obsidian 目录 → 工作岗位）──
      // 当前生效值仍用于预填（见 loadSetupState）；来源标注按使用者反馈不再显示
      const setupData = (st.setup && st.setup.data && typeof st.setup.data === 'object') ? st.setup.data : null
      const setupDomain = (setupData && setupData.domain && typeof setupData.domain === 'object') ? setupData.domain : null
      // 非预置岗位：已带入岗位名但没有正文（不自动造正文，保存前置灰并提示）
      const domainNeedsContent = Boolean(setupDomain && setupDomain.isPreset !== true
        && st.domainId && !String(domainContent || '').trim())

      const hintLine = (hint) => h('div', { key: 'h', style: S.labelHint }, hint)

      const dirField = (key, label, hint, value) => h('div', { key: 'f-' + key, style: S.coreFieldRow }, [
        h('div', { key: 'l', style: S.label }, label),
        h('div', { key: 'row', style: S.inputRow }, [
          h('input', {
            key: 'i', type: 'text', style: S.input, value: value, disabled: runRunning,
            onChange: (e) => setField(key, (e && e.target && e.target.value) || ''),
          }),
          h('button', {
            key: 'b', type: 'button', disabled: runRunning,
            style: Object.assign({}, S.btn, S.btnPick, runRunning ? S.btnDisabled : null),
            onClick: () => pickDir(key),
          }, t('initBrowse')),
        ]),
        hintLine(hint),
      ])

      const domainField = h('div', { key: 'f-domain', style: S.coreFieldRow }, [
        h('div', { key: 'l', style: S.label }, t('coreFieldDomain')),
        h('div', { key: 'row', style: S.inputRow }, [
          h('select', {
            key: 's', style: S.input, value: st.domainId, disabled: runRunning,
            onChange: (e) => onDomainChange((e && e.target && e.target.value) || ''),
          }, [h('option', { key: '__ph', value: '' }, t('coreDomainPlaceholder'))]
            .concat(domainOptions.map((d) => h('option', { key: d.id, value: d.id }, d.label)))
            .concat([h('option', { key: '__new', value: NEW_DOMAIN_VALUE }, t('coreDomainNew'))])),
        ]),
        hintLine(t('coreFieldDomainHint')),
      ])

      const dirsCard = h('div', { key: 'dirs', style: S.card }, [
        h('div', { key: 'head', style: S.cardHead }, [
          h('h3', { key: 'title', style: S.cardTitle }, t('coreDirsTitle')),
          h('div', { key: 'sub', style: S.cardSub }, t('coreDirsSub')),
        ]),
        h('div', { key: 'body', style: S.cardBody }, [
          dirField('memoryDir', t('coreFieldMemoryDir'), t('coreFieldMemoryDirHint'), st.memoryDir),
          dirField('obsidianDir', t('coreFieldObsidianDir'), t('coreFieldObsidianDirHint'), st.obsidianDir),
          domainField,
          st.domains.phase === 'error' ? h('div', { key: 'derr', style: S.warnLine }, t('coreDomainMissing') + '：' + st.domains.error) : null,
          domainNeedsContent ? h('div', { key: 'dneed', style: S.warnLine }, t('coreDomainNeedsContent')) : null,
          st.setup.phase === 'error'
            ? h('div', { key: 'seterr', style: S.note }, t('setupStateFailed') + '：' + String(st.setup.error || ''))
            : null,
          st.pickError ? h('div', { key: 'perr', style: S.warnLine }, st.pickError) : null,
          h('div', { key: 'save', style: S.saveBar }, [
            h('button', {
              key: 'go', type: 'button', disabled: !canSave,
              style: Object.assign({}, S.btn, S.btnPrimary, !canSave ? S.btnDisabled : null),
              onClick: () => runChain(0),
            }, t('coreSave')),
            h('span', { key: 'h', style: S.actionHint }, canSave ? t('coreSaveHintReady') : t('coreSaveHintWait')),
          ]),
        ]),
      ])

      // ── 渲染：执行链（保存后出现；失败停在该步，可重试）──
      const runBadgeText = runPhase === 'run' ? t('chainBadgeRun')
        : (runPhase === 'done' ? t('chainBadgeDone') : (runPhase === 'fail' ? t('chainBadgeFail') : t('chainBadgeWait')))
      const runBadgeStyle = runPhase === 'done' ? S.badgeOk
        : (runPhase === 'fail' ? S.badgeMissing : (runPhase === 'run' ? S.badgeWarn : S.badgeSkip))
      const chainCard = st.run ? h('div', { key: 'chain', style: S.card }, [
        h('div', { key: 'head', style: S.cardHead }, [
          h('h3', { key: 'title', style: S.cardTitle }, [
            t('chainTitle'),
            h('span', { key: 'b', style: S.groupCount }, badge(runBadgeText, runBadgeStyle)),
          ]),
          h('div', { key: 'sub', style: S.cardSub }, t('chainSub')),
        ]),
        h('div', { key: 'body', style: S.cardBody }, [
          h('div', { key: 'list' }, (st.run.steps || []).map((s, i) => h('div', { key: s.id, style: S.row }, [
            h('div', { key: 'head', style: S.rowHead }, [
              h('span', { key: 'no', style: Object.assign({}, S.badge, S.badgeSkip) }, s.id === 'check' ? t('chainMarkCheck') : String(i)),
              h('span', { key: 'nm', style: S.itemName }, t(CORE_CHAIN[i].labelKey)),
              h('span', { key: 'st', style: Object.assign({}, S.badge, runStateStyle(s.state)) }, t(RUN_STATE_KEYS[s.state] || 'runWait')),
            ]),
            h('div', { key: 'sub', style: S.labelHint }, t(CORE_CHAIN[i].subKey)),
            s.detail ? h('div', { key: 'd', style: S.itemDetail }, s.detail) : null,
            s.error ? h('div', { key: 'e', style: S.warnLine }, s.error) : null,
          ]))),
          runPhase === 'fail' ? h('div', { key: 'retry', style: S.actions }, [
            h('button', {
              key: 'r', type: 'button',
              style: Object.assign({}, S.btn, S.btnPrimary),
              onClick: () => runChain(st.run.failedAt),
            }, t('chainRetry')),
            h('span', { key: 'h', style: S.actionHint }, t('chainRetryHint')),
          ]) : null,
        ]),
      ]) : null

      // ── 渲染：导入引导卡（五项全绿后出现；本轮只给入口与纪律）──
      const importCard = runPhase === 'done' ? h('div', { key: 'imp', style: S.card }, [
        h('div', { key: 'head', style: S.cardHead }, [
          h('h3', { key: 'title', style: S.cardTitle }, t('importTitle')),
          h('div', { key: 'sub', style: S.cardSub }, t('importSub')),
        ]),
        h('div', { key: 'body', style: S.cardBody }, [
          h('div', { key: 'note', style: S.note }, t('importNote')),
          h('div', { key: 'act', style: S.actions }, [
            h('button', { key: 'b', type: 'button', style: S.btn, onClick: () => pickImport() }, t('importBrowse')),
          ]),
          st.imported
            ? h('div', { key: 'picked', style: S.note }, t('importPicked') + st.imported + ' · ' + t('importLater'))
            : h('div', { key: 'ph', style: S.labelHint }, t('importPlaceholder')),
        ]),
      ]) : null

      const coreBody = h('div', { key: 'core', style: gated ? S.gatedBody : null }, [dirsCard, chainCard, importCard])

      const modalNode = st.modal ? h(NewDomainModal, {
        key: 'modal', t: t, modal: st.modal,
        onName: (v) => setModal({ name: String(v || '').slice(0, DOMAIN_NAME_MAX) }),
        onContent: (v) => setModal({ content: String(v || '').slice(0, DOMAIN_CONTENT_MAX) }),
        onGenerate: generateDomain,
        onSave: saveModal,
        onCancel: closeModal,
      }) : null

      // 应用内目录浏览器弹层（方案 A）
      const browseNode = browseSt.open ? h(DirBrowserModal, {
        key: 'dirbrowser', t: t, state: browseSt,
        onNav: (p) => browseLoad(p),
        onPick: browsePick,
        onCancel: browseCancel,
        onNewName: browseNewName,
        onNew: browseNew,
      }) : null

      return h('div', null, (gated ? [gateCard, coreBody] : [coreBody]).concat([modalNode, browseNode]))
    }

    /** 新建岗位对话框（1.1.3）：岗位名称 / 岗位内容 / [自动生成] / 保存 */
    function NewDomainModal(props) {
      const t = props.t
      const m = props.modal
      const busy = m.phase === 'run'
      return h('div', { style: S.modalWrap }, [
        h('div', { key: 'mask', style: S.modalMask, onClick: () => { if (!busy) props.onCancel() } }),
        h('div', { key: 'box', style: S.modalBox }, [
          h('div', { key: 'h', style: S.modalHead }, t('modalTitle')),
          h('div', { key: 'b', style: S.modalBody }, [
            h('div', { key: 'name', style: S.cardSub }, t('modalName')),
            h('div', { key: 'ni', style: S.inputRow }, [
              h('input', {
                key: 'i', type: 'text', style: S.input, value: m.name, disabled: busy,
                maxLength: DOMAIN_NAME_MAX,
                'data-modal-field': 'name',
                onChange: (e) => props.onName((e && e.target && e.target.value) || ''),
              }),
            ]),
            h('div', { key: 'nh', style: S.labelHint }, [
              t('modalNameHint'),
              h('span', { key: 'c', style: S.actionHint }, ' · ' + fillAll(t('modalCount'), { n: String(m.name || '').length, max: DOMAIN_NAME_MAX })),
            ]),
            h('div', { key: 'ct', style: S.cardSub }, t('modalContent')),
            h('div', { key: 'ci', style: S.inputRow }, [
              h('textarea', {
                key: 'a', style: S.textarea, value: m.content, disabled: busy,
                maxLength: DOMAIN_CONTENT_MAX,
                'data-modal-field': 'content',
                onChange: (e) => props.onContent((e && e.target && e.target.value) || ''),
              }),
            ]),
            h('div', { key: 'ch', style: S.labelHint }, [
              t('modalContentHint'),
              h('span', { key: 'c', style: S.actionHint }, ' · ' + fillAll(t('modalCount'), { n: String(m.content || '').length, max: DOMAIN_CONTENT_MAX })),
            ]),
            h('div', { key: 'act', style: S.actions }, [
              h('button', {
                key: 'g', type: 'button', disabled: busy,
                style: Object.assign({}, S.btn, busy ? S.btnDisabled : null),
                onClick: () => props.onGenerate(),
              }, busy ? t('modalGenRunning') : t('modalGen')),
              h('span', { key: 'm', style: S.actionHint }, m.message || ''),
            ]),
            m.error ? h('div', { key: 'e', style: S.warnLine }, m.error) : null,
            h('div', { key: 'note', style: S.note }, t('modalNote')),
          ]),
          h('div', { key: 'f', style: S.modalFoot }, [
            h('button', { key: 'c', type: 'button', style: S.btn, disabled: busy, onClick: () => props.onCancel() }, t('modalCancel')),
            h('button', {
              key: 's', type: 'button', disabled: busy,
              style: Object.assign({}, S.btn, S.btnPrimary, busy ? S.btnDisabled : null),
              onClick: () => props.onSave(),
            }, t('modalSave')),
          ]),
        ]),
      ])
    }

    /** 应用内目录浏览器（方案 A）的初始状态；三处入口各自持有一份 */
    const DIR_BROWSER_DEFAULT = {
      open: false, phase: 'idle', path: '', parent: '', crumbs: [], entries: [],
      truncated: false, message: '', error: '', target: null,
      newName: '', newPhase: 'idle', newError: '',
    }

    /** 拉一层目录（GET /api/dirs?path=…）：成功返回可直接并入 state 的补丁；失败抛带 code/kind 的错误 */
    async function dirBrowserLoad(path) {
      const sub = path ? ('/dirs?path=' + encodeURIComponent(String(path))) : '/dirs'
      // 用 requestJsonFull：4xx 也要读响应体才能区分 native-only / no-service（可读提示的依据）
      const res = await requestJsonFull(sub, { headers: { accept: 'application/json' } }, 20000)
      const body = (res && res.body && typeof res.body === 'object') ? res.body : null
      if (!res.ok || !body) {
        const err = new Error(String((body && (body.message || body.error || body.code)) || ('HTTP ' + res.status)))
        err.code = String((body && body.code) || '')
        err.kind = String((body && body.kind) || '')
        throw err
      }
      if (body.ok === false) {
        const err = new Error(String(body.message || body.code || 'dirs 返回 ok:false'))
        err.code = String(body.code || '')
        err.kind = String(body.kind || '')
        throw err
      }
      return {
        phase: 'ready',
        path: String(body.path || ''),
        parent: String(body.parent || ''),
        crumbs: Array.isArray(body.crumbs) ? body.crumbs : [],
        entries: Array.isArray(body.entries) ? body.entries : [],
        truncated: body.truncated === true,
        message: String(body.message || ''),
        error: '',
      }
    }

    /** 目录浏览器错误 → 可读文案（native-only 与 no-service 分别说清，绝不吞） */
    function dirBrowserErrorText(t, err) {
      const e = err || {}
      const msg = String(e.message || e)
      if (e.code === 'native-only') return t('dirBrowserNativeOnly') + '：' + msg
      if (e.code === 'no-service') return t('dirBrowserNoService') + '：' + msg
      return t('dirBrowserFailed') + '：' + msg
    }

    /**
     * 应用内目录浏览器弹层（方案 A）。
     * 宿主目录能力分 native（系统对话框）与 browse（只给列举/建目录原语）；本机挑中的是 browse，
     * 所以由客户端渲染这个弹层。视觉沿用本页既有 modal 样式（modalWrap/modalMask/modalBox/…）。
     */
    function DirBrowserModal(props) {
      const t = props.t
      const b = props.state || DIR_BROWSER_DEFAULT
      const entries = Array.isArray(b.entries) ? b.entries : []
      const crumbs = Array.isArray(b.crumbs) ? b.crumbs : []
      const busy = b.phase === 'loading' || b.newPhase === 'run'
      const newName = String(b.newName || '')
      return h('div', { style: S.modalWrap, 'data-dir-browser': 'open' }, [
        h('div', { key: 'mask', style: S.modalMask, onClick: () => { if (!busy) props.onCancel() } }),
        h('div', { key: 'box', style: S.modalBox }, [
          h('div', { key: 'h', style: S.modalHead }, t('dirBrowserTitle')),
          h('div', { key: 'b', style: S.modalBody }, [
            h('div', { key: 'crumbs', style: S.crumbs }, crumbs.map((c, i) => h('button', {
              key: 'c' + i, type: 'button', style: S.crumbBtn,
              'data-dir-crumb': String(c && c.path || ''),
              onClick: () => props.onNav(String(c && c.path || '')),
            }, String((c && (c.name || c.path)) || '')))),
            h('div', { key: 'path', style: S.labelHint }, String(b.path || b.message || '')),
            b.truncated ? h('div', { key: 'tr', style: S.labelHint }, t('dirBrowserTruncated')) : null,
            b.error ? h('div', { key: 'err', style: S.warnLine }, b.error) : null,
            h('div', { key: 'list', style: S.dirList }, b.phase === 'loading'
              ? [h('div', { key: 'ld', style: S.labelHint }, t('dirBrowserLoading'))]
              : (entries.length
                ? entries.map((e) => h('button', {
                  key: String(e && (e.path || e.name) || 'x'), type: 'button', style: S.dirItem,
                  'data-dir-entry': String(e && e.path || ''),
                  onClick: () => props.onNav(String(e && e.path || '')),
                }, String((e && (e.name || e.path)) || '')))
                : [h('div', { key: 'empty', style: S.labelHint }, t('dirBrowserEmpty'))])),
            h('div', { key: 'new', style: S.actions }, [
              h('input', {
                key: 'i', type: 'text', style: S.input, value: newName, disabled: busy,
                placeholder: t('dirBrowserNewName'), 'data-dir-new-name': '1',
                onChange: (e) => props.onNewName((e && e.target && e.target.value) || ''),
              }),
              h('button', {
                key: 'c', type: 'button', disabled: busy || !newName.trim(),
                'data-dir-create': '1',
                style: Object.assign({}, S.btn, (busy || !newName.trim()) ? S.btnDisabled : null),
                onClick: () => props.onNew(),
              }, t('dirBrowserCreate')),
            ]),
            b.newError ? h('div', { key: 'ne', style: S.warnLine }, b.newError) : null,
          ]),
          h('div', { key: 'f', style: S.modalFoot }, [
            h('button', {
              key: 'up', type: 'button', disabled: busy || !b.parent,
              style: Object.assign({}, S.btn, (busy || !b.parent) ? S.btnDisabled : null),
              onClick: () => props.onNav(String(b.parent || '')),
            }, t('dirBrowserUp')),
            h('button', { key: 'cancel', type: 'button', style: S.btn, disabled: busy, onClick: () => props.onCancel() }, t('dirBrowserCancel')),
            h('button', {
              key: 'pick', type: 'button', disabled: busy || !b.path,
              'data-dir-pick': '1',
              style: Object.assign({}, S.btn, S.btnPrimary, (busy || !b.path) ? S.btnDisabled : null),
              onClick: () => props.onPick(),
            }, t('dirBrowserPick')),
          ]),
        ]),
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
        : (item.nature === 'standalone'
            ? t('natureStandalone')
            : (item.nature === 'third' ? t('natureThird') : t('statusUnknown')))
      const natureStyle = item.nature === 'self'
        ? S.badgeOk
        : (item.nature === 'standalone'
            ? S.badgeBrand
            : (item.nature === 'third' ? S.badgeWarn : S.badgeSkip))
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
      // 残留目录（目录在、依赖与 bundles 都没登记）：给可读提示，并**照常提供安装按钮**
      if (item.residual) nodes.push(h('div', { key: 'res', style: S.note }, t('plugResidueHint')))
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
        // 2026-09-14：repoRoot 可配置 —— 输入框值 / 当前来源 / 四种来源回显 / 保存结果提示
        settingsRepoRoot: '', configRepoRoot: '', profileRepoRoot: '', repoRootError: '',
        repoRootSourceDetail: '', repoRootInput: '', repoRootMsg: '', repoRootErr: false, repoRootBusy: false,
      })
      const st = state[0]
      const setSt = state[1]

      /** 仓库根来源 → 可读文案 */
      function repoRootSourceText(t, detail) {
        const map = {
          settings: 'repoRootSrcSettings',
          config: 'repoRootSrcConfig',
          patch: 'repoRootSrcPatch',
          ancestor: 'repoRootSrcAncestor',
          common: 'repoRootSrcCommon',
        }
        const key = map[detail]
        return key ? t(key) : t('repoRootSrcNone')
      }

      /**
       * 保存 repoRoot（POST /repo-root）：写设置用户层（免重启）；服务端设置不可用时退回写
       * profile 的 cordis.patch.yml。**非空但无效时服务端返回 400 且不写盘** —— 这里原样回显。
       */
      async function saveRepoRoot(value) {
        setSt((prev) => Object.assign({}, prev, { repoRootBusy: true, repoRootMsg: '', repoRootErr: false }))
        let okFlag = false
        let msg = ''
        try {
          const res = await requestJsonFull('/repo-root', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ repoRoot: String(value == null ? '' : value) }),
          }, 30000)
          const body = (res && res.body && typeof res.body === 'object') ? res.body : {}
          okFlag = Boolean(res && res.ok === true && body.ok === true)
          msg = firstText(body.message)
            || (okFlag
              ? (String(value || '').trim() ? t('repoRootFieldSaved') : t('repoRootFieldCleared'))
              : t('repoRootFieldFailed'))
        } catch (err) {
          msg = String((err && err.message) || err)
        }
        setSt((prev) => Object.assign({}, prev, { repoRootBusy: false, repoRootMsg: msg, repoRootErr: !okFlag }))
        if (okFlag) await detect()
      }

      async function detect() {
        setSt((prev) => Object.assign({}, prev, { phase: 'loading', error: '' }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const body = await getJson('/plugins', 15000)
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          if (body.ok === false) throw new Error(String(body.error || 'plugins 返回 ok:false'))
          const settingsRepoRoot = typeof body.settingsRepoRoot === 'string' ? body.settingsRepoRoot.trim() : ''
          setSt((prev) => Object.assign({}, prev, {
            phase: 'ready', error: '',
            items: pluginList(body),
            repoRoot: typeof body.repoRoot === 'string' ? body.repoRoot.trim() : '',
            // 接口的 message（例如「未找到当前 profile 目录」）原样回显，不吞掉可读原因
            hint: typeof body.message === 'string' ? body.message.trim() : '',
            // 2026-09-14：四种来源分别回显（设置 / 部署配置 / profile 配置 / 自动探测）
            settingsRepoRoot: settingsRepoRoot,
            configRepoRoot: typeof body.configRepoRoot === 'string' ? body.configRepoRoot.trim() : '',
            profileRepoRoot: typeof body.profileRepoRoot === 'string' ? body.profileRepoRoot.trim() : '',
            repoRootError: typeof body.repoRootError === 'string' ? body.repoRootError.trim() : '',
            repoRootSourceDetail: typeof body.repoRootSourceDetail === 'string' ? body.repoRootSourceDetail.trim() : '',
            repoRootInput: settingsRepoRoot,
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
            // 2026-09-14：repoRoot 可配置（可读可写、免重启生效）—— 这就是「设置里指定」的落点；
            // 留空 = 自动探测；服务端设置不可用时退回写 profile 的 cordis.patch.yml。
            h('div', { key: 'rrcfg', style: S.note }, [
              h('div', { key: 't', style: S.label }, t('repoRootFieldLabel')
                + '（' + t('repoRootSourceNow') + '：' + repoRootSourceText(t, st.repoRootSourceDetail)
                + (st.repoRoot ? ' · ' + st.repoRoot : '') + '）'),
              h('div', { key: 'row', style: S.inputRow }, [
                h('input', {
                  key: 'i', type: 'text', style: S.input,
                  value: st.repoRootInput,
                  placeholder: t('repoRootFieldEmpty'),
                  disabled: st.repoRootBusy || loading,
                  onChange: (e) => {
                    const v = (e && e.target && typeof e.target.value === 'string') ? e.target.value : ''
                    setSt((prev) => Object.assign({}, prev, { repoRootInput: v }))
                  },
                }),
                h('button', {
                  key: 'b', type: 'button',
                  disabled: st.repoRootBusy || loading || st.repoRootInput === (st.settingsRepoRoot || ''),
                  style: Object.assign({}, S.btn,
                    (st.repoRootBusy || loading || st.repoRootInput === (st.settingsRepoRoot || '')) ? S.btnDisabled : null),
                  onClick: () => saveRepoRoot(st.repoRootInput),
                }, st.repoRootBusy ? t('repoRootFieldSaving') : t('repoRootFieldSave')),
              ]),
              h('div', { key: 'h', style: S.labelHint }, t('repoRootFieldHint')),
              st.repoRootError ? h('div', { key: 'e', style: S.errorMsg }, st.repoRootError) : null,
              st.repoRootMsg ? h('div', { key: 'm', style: st.repoRootErr ? S.errorMsg : S.labelHint }, st.repoRootMsg) : null,
            ]),
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
        detected: '', libraryName: '', memoryRoot: '<DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory', obsidianOff: false,
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
          const memRoot = firstText(body.memoryRoot, body.defaultMemoryRoot) || '<DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory'
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
                    // 新默认记忆库路径是固定目录（不再拼库名）：<DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory
      st.memoryRoot ? st.memoryRoot : '',
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
    const CFG_NS_DOCS = 'dsh-doc-suite'
    const CFG_NS_LIST = [CFG_NS_MEMORY, CFG_NS_EXPERTS, CFG_NS_DOCS]
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
      // 专家库（dsh-experts 0.4.0 schema 全量 18 键；injectOrder 只在部署层 base）
      expertsEnabled: { type: 'bool' },
      injectOrder: { type: 'num' },
      expertCatalogEnabled: { type: 'bool' },
      disciplineEnabled: { type: 'bool' },
      disciplineMemoryDir: { type: 'str' },
      defaultDomain: { type: 'select' },
      identityExpert: { type: 'str' },
      enabledDomains: { type: 'str' },
      enabledExperts: { type: 'str' },
      // expertInjectMax（2026-09-15 起**写死 4、设置页不再提供该项**）：meta 保留但不列入
      // CFG_EXPERT_GROUPS —— renderNsCard 会跳过「有 meta 但未归组」的键；若连 meta 一起删，
      // 它反而会落进「接口多出来的键」兜底组被渲染出来（见 renderNsCard 的 extra 逻辑）。
      expertInjectMax: { type: 'slider', min: 1, max: 4, step: 1 },
      expertInjectDetail: {
        type: 'select',
        options: [['auto', 'cfgDetailAuto'], ['card', 'cfgDetailCard'], ['full', 'cfgDetailFull']],
      },
      expertInjectBudgetChars: { type: 'slider', min: 200, max: 20000, step: 100 },
      expertFullHitMax: { type: 'slider', min: 1, max: 4, step: 1 },
      expertSecondThreshold: { type: 'slider', min: 0, max: 1, step: 0.05 },
      expertGeneralMax: { type: 'num' },
      expertGeneralMinEvidence: { type: 'slider', min: 0, max: 1, step: 0.05 },
      skillInjectEnabled: { type: 'bool' },
      skillBudgetChars: { type: 'slider', min: 0, max: 2000, step: 100 },
      expertShowBanner: { type: 'bool' },
      expertSetupDone: { type: 'bool' },
      // dsh-doc-suite（文档能力）的媒体设置：**扁平顶层键**（0.7.7 起，原嵌套 media.* 在宿主侧写不进）
      mediaProvider: { type: 'select', options: [['volcengine-ark', 'cfgProviderArk']] },
      mediaImageEnabled: { type: 'bool' },
      mediaImageModel: { type: 'str' },
      mediaImageSize: { type: 'str' },
      mediaImageTimeoutMs: { type: 'num' },
      mediaImageRetries: { type: 'num' },
      mediaImageFallbackToVector: { type: 'bool' },
      mediaVideoEnabled: { type: 'bool' },
      mediaVideoModel: { type: 'str' },
      mediaArkApiKey: { type: 'str' },
      mediaArkEndpoint: { type: 'str' },
    }

    /**
     * T5（1.1.3）配置页键位口径 —— 本页键位的**唯一定义处**。
     * 依据：0.产出物/2026-09-16-02_工作秘书UI改版预览/T5-配置页键位施工表.md（设计定稿 §12.1）。
     * primary = 常显；advanced = 高级（折叠）。**未列出的键一律不渲染** ——
     * 「不放出 ≠ 删除」：settings.yaml 与 profile 覆盖层仍可配，只是不出现在本页。
     * 计数：记忆库 5+8（不放出 11）· 专家库 5+5（不放出 9）· 文档能力 4+5（不放出 2）。
     */
    const CFG_T5_GROUPS = {
      'work-memory': [
        {
          id: 'primary', titleKey: '', hintKey: '',
          keys: ['injectMemory', 'personaLabel', 'snapshotMaxChars', 'memoryDir', 'obsidianSyncDir'],
        },
        {
          id: 'advanced', titleKey: 'cfgT5Advanced', hintKey: '', fold: true,
          keys: ['snapshotLimitGlobal', 'snapshotLimitUser', 'snapshotLimitProject', 'snapshotLimitDaily',
            'backupDir', 'reviewEnabled', 'triageAskInSnapshot', 'backupEnabled'],
        },
      ],
      experts: [
        {
          id: 'primary', titleKey: '', hintKey: '',
          // identityExpert 自 dsh-experts 0.3.0「身份退场」起不再由使用者配置（使用者 2026-09-16 裁定）：
          // 从常显移出、不渲染；设置项本身与 schema 保留，settings.yaml 仍可配。
          keys: ['expertsEnabled', 'defaultDomain', 'expertInjectDetail', 'expertShowBanner'],
        },
        {
          id: 'advanced', titleKey: 'cfgT5Advanced', hintKey: '', fold: true,
          keys: ['expertInjectBudgetChars', 'skillBudgetChars',
            'expertCatalogEnabled', 'disciplineEnabled', 'skillInjectEnabled'],
        },
      ],
      'dsh-doc-suite': [
        {
          id: 'primary', titleKey: '', hintKey: '',
          keys: ['mediaImageEnabled', 'mediaArkApiKey', 'mediaImageModel', 'mediaVideoEnabled'],
        },
        {
          id: 'advanced', titleKey: 'cfgT5Advanced', hintKey: '', fold: true,
          keys: ['mediaImageSize', 'mediaImageTimeoutMs', 'mediaImageRetries', 'mediaVideoModel',
            'mediaImageFallbackToVector'],
        },
      ],
    }

    /** ns → 分组定义（= T5 键位计划） */
    const CFG_GROUPS = CFG_T5_GROUPS

    /**
     * 逐键控件覆盖（施工表「控件」列）：
     * - password：密钥类，输入框 type=password（不打印、不落日志、不进报错）
     * - dir：路径类，文本框 +「浏览…」目录入口
     * - options：select 选项（[值, 字典键]）；不覆盖时回落岗位域表
     */
    const CFG_FIELD_OVERRIDE = {
      mediaArkApiKey: { control: 'password' },
      memoryDir: { control: 'dir' },
      obsidianSyncDir: { control: 'dir' },
      backupDir: { control: 'dir' },
      defaultDomain: { options: DOMAIN_OPTIONS },
      expertInjectDetail: {
        options: [['auto', 'cfgDetailAuto'], ['card', 'cfgDetailCard'], ['full', 'cfgDetailFull']],
      },
    }
    const CFG_NS_TITLE_KEY = { 'work-memory': 'cfgGroupMemory', experts: 'cfgGroupExperts', 'dsh-doc-suite': 'cfgGroupDocs' }

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
    const CFG_NS_LEAD_KEY = { 'work-memory': 'cfgMemoryLead', experts: 'cfgExpertsLead', 'dsh-doc-suite': 'cfgDocSettingsLead' }


    /** 文档模块的四个技能（静态清单：落盘状态由文档模块自检给出，本页不臆断） */
    const CFG_DOC_SKILLS = [
      ['office-word', 'cfgDocSkillWord'],
      ['office-excel', 'cfgDocSkillExcel'],
      ['office-ppt', 'cfgDocSkillPpt'],
      ['pdf-tools', 'cfgDocSkillPdf'],
      ['media-gen', 'cfgDocSkillMediaGen'],
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
      const override = CFG_FIELD_OVERRIDE[key] || null
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
        // 选项来源：T5 覆盖表 → 字段自带 options（[值, 字典 key] 对）→ 回落到岗位域表
        const opts = (override && Array.isArray(override.options) && override.options.length > 0)
          ? override.options
          : (Array.isArray(meta.options) && meta.options.length > 0 ? meta.options : DOMAIN_OPTIONS)
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
        // T5 控件覆盖：密钥 → password（不回显明文、不进报错）；路径 → 文本 + 目录入口
        const isSecret = Boolean(override && override.control === 'password')
        const isDir = Boolean(override && override.control === 'dir')
        const textInput = h('input', Object.assign({
          key: 'i', type: isSecret ? 'password' : 'text', style: S.input,
          autoComplete: isSecret ? 'new-password' : 'off',
          value: rawValue === undefined || rawValue === null ? '' : String(rawValue),
        }, inputProps('set')))
        control = isDir ? h('div', { key: 'd', style: S.inputRow }, [
          textInput,
          h('button', {
            key: 'p', type: 'button', disabled: busy,
            'data-cfg-action': 'pick-dir', 'data-cfg-key': key,
            style: Object.assign({}, S.btn, S.btnPick, busy ? S.btnDisabled : null),
            onClick: () => { if (typeof handlers.pickDir === 'function') handlers.pickDir(nsKey, key) },
          }, t('initBrowse')),
        ]) : textInput
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
      // 标题留空的小节（T5 常显档）直接渲染字段，不再套一层小节头
      const head = def.titleKey
        ? h('div', { key: 't', style: S.cfgSectionTitle }, [
          t(def.titleKey),
          def.slider ? badge(t('cfgAppliedLive'), S.badgeOk) : null,
        ])
        : null
      const hint = def.hintKey ? h('div', { key: 'h', style: S.cfgSectionHint }, t(def.hintKey)) : null
      const body = h('div', { key: 'b' }, rows)
      // 高级档（T5）：同样的字段，只是默认折叠；计数写进标题，避免使用者以为少放了键
      if (!def.fold) return h('div', { key: 'sec-' + def.id, style: S.cfgSection }, [head, hint, body])
      return h('details', { key: 'sec-' + def.id, style: S.cfgFold }, [
        h('summary', { key: 's', style: S.cfgFoldSummary }, fill(t('cfgT5Advanced'), rows.length)),
        h('div', { key: 'b', style: S.cfgFoldBody }, [head, hint, body]),
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
            + 'expertInjectBudgetChars=' + String(conf.expertInjectBudgetChars)) : null,
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
        // 应用内目录浏览器（方案 A）；null = 未打开
        browse: null,
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

      // ── 目录选择：native 优先，native 不可用时转应用内浏览器（方案 A，与核心配置页同源）──
      const browseSt = Object.assign({}, DIR_BROWSER_DEFAULT, st.browse || {})
      function browseLoad(path) {
        setSt((prev) => Object.assign({}, prev, {
          browse: Object.assign({}, DIR_BROWSER_DEFAULT, prev.browse || {}, { phase: 'loading', error: '', newError: '' }),
        }))
        dirBrowserLoad(path).then((patch) => {
          setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, patch) }))
        }).catch((err) => {
          setSt((prev) => Object.assign({}, prev, {
            browse: Object.assign({}, prev.browse, { phase: 'error', error: dirBrowserErrorText(t, err) }),
          }))
        })
      }
      function openDirBrowser(target, startPath) {
        setSt((prev) => Object.assign({}, prev, {
          browse: Object.assign({}, DIR_BROWSER_DEFAULT, { open: true, phase: 'loading', target: target }),
          notice: '', noticeKind: '',
        }))
        dirBrowserLoad(String(startPath || '').trim()).then((patch) => {
          setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, patch) }))
        }).catch((err) => {
          setSt((prev) => Object.assign({}, prev, {
            browse: Object.assign({}, prev.browse, { phase: 'error', error: dirBrowserErrorText(t, err) }),
          }))
        })
      }
      function browsePick() {
        const target = (browseSt.target && typeof browseSt.target === 'object') ? browseSt.target : {}
        const path = String(browseSt.path || '')
        if (!path) return
        if (target.ns && target.key) setDraft(target.ns, target.key, path)
        setSt((prev) => Object.assign({}, prev, { browse: null }))
      }
      function browseCancel() { setSt((prev) => Object.assign({}, prev, { browse: null })) }
      function browseNewName(v) {
        setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, { newName: String(v || '') }) }))
      }
      function browseNew() {
        const parent = String(browseSt.path || '')
        const name = String(browseSt.newName || '').trim()
        if (!name) {
          setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, { newError: t('dirBrowserNewNameRequired') }) }))
          return
        }
        setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, { newPhase: 'run', newError: '' }) }))
        postFull('/dirs/new', { path: parent, name: name }, 60000).then((res) => {
          const body = (res && res.body && typeof res.body === 'object') ? res.body : {}
          if (!res.ok || body.ok === false) {
            setSt((prev) => Object.assign({}, prev, {
              browse: Object.assign({}, prev.browse, {
                newPhase: 'idle',
                newError: t('dirBrowserNewFailed') + '：' + String(body.message || body.error || ('HTTP ' + res.status)),
              }),
            }))
            return
          }
          setSt((prev) => Object.assign({}, prev, { browse: Object.assign({}, prev.browse, { newPhase: 'idle', newName: '', newError: '' }) }))
          browseLoad(String(body.path || parent))
        }, (err) => {
          setSt((prev) => Object.assign({}, prev, {
            browse: Object.assign({}, prev.browse, { newPhase: 'idle', newError: t('dirBrowserNewFailed') + '：' + String((err && err.message) || err) }),
          }))
        })
      }

      const handlers = {
        busy: Boolean(st.busyNs),
        setDraft: setDraft,
        // 路径类键的目录入口（T5）：native 优先，native 不可用时转应用内浏览器
        pickDir: (ns, key) => {
          const curNs = st.namespaces[ns] || {}
          const start = (st.drafts[ns] && st.drafts[ns][key] !== undefined)
            ? String(st.drafts[ns][key] || '')
            : String((curNs.value && curNs.value[key]) || '')
          const fn = props.pickDirectory
          if (typeof fn !== 'function') { openDirBrowser({ ns: ns, key: key }, start); return }
          Promise.resolve().then(() => fn()).then((dir) => {
            if (typeof dir === 'string' && dir.trim()) setDraft(ns, key, dir.trim())
          }).catch((err) => {
            const msg = String((err && err.message) || err)
            if (msg.indexOf('native capability') >= 0 || msg.indexOf('系统目录选择器') >= 0) { openDirBrowser({ ns: ns, key: key }, start); return }
            setSt((prev) => Object.assign({}, prev, {
              notice: t('initPickFailed') + msg, noticeKind: 'warn',
            }))
          })
        },
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
          // T5：**只渲染键位计划内的键**。宿主 schema 里其余键（算法常数 / 运维阈值 /
          // 固定技术值）一律不渲染 —— 不是删除，settings.yaml 与 profile 覆盖层仍可配。
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
        st.activeGroup === 'docs' ? h('div', { key: 'docs', style: { display: 'grid', gap: '12px' } }, [
          renderNsCard(CFG_NS_DOCS, null),
          h(DocPanel, { key: 'panel', t: t }),
        ]) : null,
        st.activeGroup === 'pet' ? h(PetPanel, { key: 'pet', t: t, openSection: props.openSection }) : null,
        // 应用内目录浏览器弹层（方案 A）
        browseSt.open ? h(DirBrowserModal, {
          key: 'dirbrowser', t: t, state: browseSt,
          onNav: (p) => browseLoad(p),
          onPick: browsePick,
          onCancel: browseCancel,
          onNewName: browseNewName,
          onNew: browseNew,
        }) : null,
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
      // 默认落在「安装与检查」（1.1.3：打开即从环境检查起步）；initialTab 供冒烟测试与深链指定页签。
      // 1.1.3：页签栏只有四个（install / core / config / about）。旧页签 'plugins' 与 'init'
      // 已从页签栏下线（前者并入 install 的子插件分组，后者由 core 承接）；两个组件暂留并
      // 保持深链可达，等核心配置的目录与岗位落地后与既有回归一起收口。
      const first = ['install', 'core', 'plugins', 'init', 'config', 'about'].indexOf(props.initialTab) >= 0 ? props.initialTab : 'install'
      const state = useState(first)
      const tab = state[0]
      const setTab = state[1]
      // P3 首用引导：只在**未显式指定页签**时探测 setupNeeded（显式深链/冒烟不额外发请求）；
      // setupNeeded 缺失按 false 处理（向后兼容），为 true 时默认落到「核心配置」页
      //（1.1.3：原「初始化」页签已下线，其职能由「核心配置」承接，见 setTab('core')）。
      const setup = useState({ needed: false, count: 0 })
      const setupSt = setup[0]
      const setSetup = setup[1]
      /**
       * 环境检测（GET /check）**提升到本组件**：安装与检查页、核心配置页共用同一份结果，
       * 进入分区只发一次；「重新检测」刷新的是这一份（使用者反馈：核心配置页不该自己再跑一遍）。
       */
      const checkState = useState({ phase: 'loading', items: [], checkedAt: '', error: '' })
      const checkSt = checkState[0]
      const setCheckSt = checkState[1]
      async function loadCheck() {
        setCheckSt((prev) => Object.assign({}, prev, { phase: 'loading', error: '' }))
        try {
          if (typeof fetch !== 'function') throw new Error('fetch 不可用（当前载体没有 HTTP 通道）')
          const body = await getJson('/check', 15000)
          if (!body || typeof body !== 'object') throw new Error('响应不是 JSON 对象')
          if (body.ok === false) throw new Error(String(body.error || 'check 返回 ok:false'))
          setCheckSt((prev) => Object.assign({}, prev, {
            phase: 'ready', error: '',
            items: Array.isArray(body.items) ? body.items : [],
            checkedAt: typeof body.checkedAt === 'string' ? body.checkedAt : '',
          }))
        } catch (err) {
          setCheckSt((prev) => Object.assign({}, prev, { phase: 'error', error: String((err && err.message) || err) }))
        }
      }
      useEffect(() => { loadCheck() }, [])
      useEffect(() => {
        if (props.initialTab) return
        if (typeof fetch !== 'function') return
        let alive = true
        getJson('/basedeck', 15000).then((body) => {
          if (!alive || !body || typeof body !== 'object' || body.ok === false) return
          if (body.setupNeeded !== true) return
          setSetup({ needed: true, count: setupCount(body) })
          setTab('core')
        }).catch(() => { /* 探测失败不打扰：默认页保持原样 */ })
        return () => { alive = false }
      }, [])
      let page = null
      const checkProps = { check: checkSt, onRefreshCheck: loadCheck }
      if (tab === 'install') page = h(InstallPage, Object.assign({ key: 'i', t: t }, checkProps))
      else if (tab === 'core') page = h(CorePage, Object.assign({
        key: 'c0', t: t,
        onGoInstall: () => setTab('install'),
        // 目录选择入口：与配置页同源（native 优先，不可用时页面内部转应用内浏览器）
        pickDirectory: props.pickDirectory,
      }, checkProps))
      else if (tab === 'plugins') page = h(PluginsPage, { key: 'g', t: t })
      else if (tab === 'init') page = h(InitPage, {
        key: 'n', t: t,
        pickDirectory: props.pickDirectory,
        onConfigured: () => setSetup({ needed: false, count: 0 }),
      })
      else if (tab === 'config') page = h(ConfigPage, { key: 'c', t: t, openSection: props.openSection, pickDirectory: props.pickDirectory })
      else page = h(AboutPage, { key: 'a', t: t })
      return h('div', { style: S.wrap }, [
        h('h1', { key: 'h', style: S.h1 }, t('title')),
        h(StatusBar, { key: 'b', t: t }),
        setupSt.needed ? h('div', { key: 'setup', style: S.setupBar }, [
          h('span', { key: 'x', style: S.setupText }, fill(t('setupNeeded'), setupSt.count)),
          h('button', {
            key: 'go', type: 'button',
            style: Object.assign({}, S.btn, S.btnPrimary),
            onClick: () => setTab('core'),
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
