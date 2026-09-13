/**
 * work-personal-secretary —— 集成体本体 · Web 客户端半（DSH 0.1.5-rc.1 原生架构）
 *
 * 注册方式：原生 `settings.section` 槽位 → 设置左侧出现独立分区「工作秘书」。
 * 为什么不用宿主「插件配置」页：那一页只列**宿主平面插件**（终端 / Agent 循环 /
 * Subagent / 网页搜索），用户插件要出现在其中需自行贡献 `settings.plugin.item`；
 * 本集成体选择独立分区，既不与宿主插件混淆，也好找。
 *
 * 写法沿用集成体现有模块的**手写 loader bundle**：不引入构建步骤，
 * 只依赖宿主注入的 react（`window.__ModuleLoader__` 模块表）。
 * 版本号与 package.json 同步维护（见 BUILD）。
 */
window.__ModuleLoader__.load({
  id: 'work-personal-secretary',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState

    const NS = 'work-personal-secretary'
    /** 构建/界面标记：与 package.json 的 version 同步 */
    const BUILD = 'v1.0.0'

    const ZH = {
      nav: '工作秘书',
      title: '工作秘书',
      lead: '一个集成体统一五套能力。安装与检查、能力配置在后续版本提供；本版先交付「关于与致谢」。',
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
      devInstall:
        '安装与检查将按四步引导：环境检查 → 依赖补齐 → 安装子插件 → 配置底座。它会先确保宿主、解释器与系统组件就绪，再交付能力；商用软件（如 WPS）只给命令与指引，不代装。',
      devConfig:
        '能力配置将把五个子插件的设置集中到这一个分区里读写：记忆库、专家库、文档能力、桌面形象各自分组。子插件的配置命名空间保持独立，单独安装时仍可各自配置。',
      back: '返回',
    }

    const EN = {
      nav: 'Work Secretary',
      title: 'Work Secretary',
      lead: 'One integrator for five capabilities. Install & Check and Capability Config arrive in later versions; this build ships About & Credits.',
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
      devInstall:
        'Install & Check will guide four steps: environment check, dependency completion, sub-plugin installation, and configuration groundwork. It ensures host, interpreter and system components are ready before delivering capabilities; commercial software (e.g. WPS) is never auto-installed.',
      devConfig:
        'Capabilities will gather the five sub-plugins settings into this one section, grouped per module. Each sub-plugin keeps its own settings namespace so it still works standalone.',
      back: 'Back',
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
    }

    function badge(text, extra) {
      return h('span', { style: Object.assign({}, S.badge, extra || {}) }, text)
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
      const items = [['install', t('tabInstall')], ['config', t('tabConfig')], ['about', t('tabAbout')]]
      return h('div', { style: S.tabs }, items.map((it) =>
        h('button', {
          key: it[0], type: 'button', style: S.tab(props.tab === it[0]),
          onClick: () => props.setTab(it[0]),
        }, it[1])))
    }

    function Placeholder(props) {
      const t = props.t
      const body = props.which === 'install' ? t('devInstall') : t('devConfig')
      return h('div', { style: S.placeholder }, [
        h('div', { key: 'h', style: { fontWeight: 650, color: '#1f2328', marginBottom: '6px' } }, t('devTitle')),
        h('div', { key: 'b' }, body),
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
      const state = useState('about')
      const tab = state[0]
      const setTab = state[1]
      return h('div', { style: S.wrap }, [
        h('h1', { key: 'h', style: S.h1 }, t('title')),
        h('p', { key: 'l', style: S.lead }, t('lead')),
        h(StatusBar, { key: 'b', t }),
        h(Tabs, { key: 't', t, tab, setTab }),
        tab === 'about' ? h(AboutPage, { key: 'a', t }) : h(Placeholder, { key: 'p', t, which: tab }),
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

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'work-personal-secretary',
        order: 35,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t }),
      }, () => h(Section, { t })))
    }

    return { apply, inject: ['slots'] }
  },
})
