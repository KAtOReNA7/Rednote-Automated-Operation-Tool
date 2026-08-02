import { Button, Icon, PageHeader, useV2Controller } from '../components.js';

export function SettingsPage(): React.JSX.Element {
  const { notify, session, setSession } = useV2Controller();
  const update = (field: 'audience' | 'boundary' | 'name' | 'tone', value: string): void =>
    setSession((current) => ({ ...current, persona: { ...current.persona, [field]: value } }));
  const save = (): void => {
    const bridge = window.rednoteV2;
    if (bridge === undefined) {
      notify('账号人设已保存到当前模拟会话；关闭后重置。');
      return;
    }
    void bridge
      .updatePersona({
        expectedRevision: session.persona.revision,
        persona: {
          audience: session.persona.audience,
          boundary: session.persona.boundary,
          name: session.persona.name,
          tone: session.persona.tone,
        },
      })
      .then((result) => {
        if (!result.ok) {
          notify(result.error.message);
          if (result.error.code === 'REVISION_CONFLICT') {
            void bridge.readPersona().then((latest) => {
              if (latest.ok) {
                setSession((current) => ({ ...current, persona: { ...latest.value } }));
              }
            });
          }
          return;
        }
        setSession((current) => ({ ...current, persona: { ...result.value } }));
        notify(`账号人设已保存到本机 · revision ${result.value.revision}`);
      });
  };
  return (
    <div className="v2-page">
      <PageHeader
        actions={
          <Button icon="check" onClick={save} tone="primary">
            保存设置
          </Button>
        }
        description="普通设置表达业务含义；保存后会在重新启动 V2 时恢复。"
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
              <p>人设与周计划保存到本机；内容正文仍为模拟数据。</p>
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
