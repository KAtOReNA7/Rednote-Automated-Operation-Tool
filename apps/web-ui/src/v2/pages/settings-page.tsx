import { Button, Icon, PageHeader, useV2Controller } from '../components.js';
import type { V2Session } from '../mock-provider.js';

export function SettingsPage(): React.JSX.Element {
  const { notify, session, setSession } = useV2Controller();
  const update = (field: keyof V2Session['persona'], value: string): void =>
    setSession((current) => ({ ...current, persona: { ...current.persona, [field]: value } }));
  return (
    <div className="v2-page">
      <PageHeader
        actions={
          <Button
            icon="check"
            onClick={() => notify('账号人设已保存到当前模拟会话；关闭后重置。')}
            tone="primary"
          >
            保存设置
          </Button>
        }
        description="普通设置表达业务含义；所有改动只保存在当前模拟会话。"
        eyebrow="账号人设与本地运行"
        title="设置"
      />
      <div className="v2-settings-grid">
        <section className="v2-card v2-settings">
          <div className="v2-settings-title">
            <Icon name="user-circle" size={24} />
            <div>
              <h2>账号人设</h2>
              <p>决定计划、文案和回复建议如何表达。</p>
            </div>
          </div>
          {(
            [
              ['name', '账号名称'],
              ['audience', '目标受众'],
              ['tone', '表达语气'],
            ] as const
          ).map(([field, label]) => (
            <label className="v2-field" key={field}>
              <span>{label}</span>
              <input
                onChange={(event) => update(field, event.target.value)}
                value={session.persona[field]}
              />
            </label>
          ))}
          <label className="v2-field">
            <span>内容边界</span>
            <textarea
              onChange={(event) => update('boundary', event.target.value)}
              rows={4}
              value={session.persona.boundary}
            />
          </label>
        </section>
        <aside className="v2-settings-aside">
          <section className="v2-card">
            <Icon name="sparkle" />
            <div>
              <h2>AI 服务</h2>
              <p>尚未接入；没有调用真实模型。</p>
            </div>
            <button onClick={() => notify('AI 服务尚未接入。')} type="button">
              模拟状态
            </button>
          </section>
          <section className="v2-card">
            <Icon name="books" />
            <div>
              <h2>本地数据</h2>
              <p>不读取项目数据库，也不保存真实内容。</p>
            </div>
            <button onClick={() => notify('高级本地设置尚未接入。')} type="button">
              高级设置（未接入）
            </button>
          </section>
          <section className="v2-card">
            <Icon name="paper-plane-tilt" />
            <div>
              <h2>平台操作</h2>
              <p>发布、评论和私信由用户在官方端手动完成。</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
