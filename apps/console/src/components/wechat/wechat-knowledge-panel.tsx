import { SystemKnowledgePanel } from "@/components/console/system-knowledge-panel"

/** 微信壳层 · 知识库 — 专家模式（来源/检索/Lint/审阅），无二级侧栏。 */
export function WechatKnowledgePanel() {
  return (
    <div className="wechat-knowledge-expert h-full min-h-0">
      <SystemKnowledgePanel variant="wechat" />
    </div>
  )
}
