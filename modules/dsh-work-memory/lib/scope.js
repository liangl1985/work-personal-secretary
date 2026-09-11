/**
 * work-memory — 写入范围的分类决策（护栏核心，纯函数、无依赖、可单测）
 *
 * 2026-09-11 使用者批准：此前 `scope` 默认 project 但 `branch` 默认 null，
 * 而 project 无 branch 时兜底写 MEMORY.md（全局）→ 项目类记忆静默污染全局。
 * 这里把决策收成一处，规则：
 *   1. branch 优先取显式参数，其次会话推断（由调用方传入 resolvedBranch）；
 *   2. scope=auto（默认）：有 branch → project，无 branch → daily（当天流水最安全）；
 *   3. scope=project 但没有 branch → **报错**，绝不静默写进全局；
 *   4. global / user 必须显式指定（各自不带 branch）。
 *
 * @module work-memory/scope
 */

export const WRITE_SCOPES = ['global', 'user', 'project', 'daily']

/** 给模型看的分类判据（写进工具描述，保持单一真源） */
export const SCOPE_CRITERIA = [
  'global=只放跨模块且不随项目变的根本内容：助手身份/性格/保密红线/协作铁律/长期工作约定（稀缺资源）；',
  'user=使用者的个人画像、偏好、习惯、对助手的交互要求；',
  'project=与某个具体项目/插件/任务有关的经验、决策、踩坑、待办（默认落点，需 branch）；',
  'daily=当天发生的流水与一次性记录。',
].join('')

/**
 * 解析本次写入的目标范围。
 * @param {object} input - { requested, explicitBranch, sessionBranch }
 * @returns {{ scope?: string, branch?: string|null, error?: string }}
 */
export function resolveWriteScope({ requested, explicitBranch, sessionBranch } = {}) {
  const req = String(requested || 'auto').trim() || 'auto'
  const branch = (explicitBranch && String(explicitBranch).trim()) || sessionBranch || null

  if (req === 'auto') {
    return branch ? { scope: 'project', branch } : { scope: 'daily', branch: null }
  }
  if (!WRITE_SCOPES.includes(req)) {
    return { error: '未知 scope：' + req + '（可用 global/user/project/daily/auto）' }
  }
  if (req === 'project') {
    if (!branch) {
      return {
        error: 'project 范围需要项目名（branch）：本次既未显式传入，也无法从会话工作目录推断。'
          + '请显式传 branch（如 "DSH插件"），或改用 global / user / daily。'
          + '（护栏：项目记忆不会被静默写进全局）',
      }
    }
    return { scope: 'project', branch }
  }
  return { scope: req, branch: null }
}
