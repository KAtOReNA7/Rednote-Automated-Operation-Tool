# Search Fixture V1

`search-fixture-v1` 只用于自动化测试和离线演示，不是生产 Search API 配置格式。

```ts
interface SearchFixtureV1 {
  contractVersion: 'search-fixture-v1';
  fixtureId: string; // 1—128 个安全标识字符
  appearances: SearchCandidateAppearanceV1[]; // 最多 20
}
```

每个 appearance 必须显式包含 URL、有限 title/preview、sourceMetadataKind、citationState、
consulted/cited、rank/upstream ID、日期/语言和 userSupplied。缺失字段、额外字段、非法 URL 或超限
值均拒绝。

测试 fixture 可使用：

- Scripted model execution result；
- `ScriptedSearchApiCodec` / `ScriptedSearchApiTransport`；
- 仅绑定 `127.0.0.1` 的 `LoopbackSearchApiCodec`；
- 运行时随机 credential 值和临时 SQLite。

fixture 不得包含真实密钥、真实供应商 endpoint、真实 API 响应、页面正文、selectedText、截图、
用户数据或付费调用。Loopback 响应中的结果 URL 只进入 `LEAD_ONLY / NOT_FETCHED` 候选，测试也不
得连接它。产品 composition 不注册 Loopback/Scripted Search API codec。
