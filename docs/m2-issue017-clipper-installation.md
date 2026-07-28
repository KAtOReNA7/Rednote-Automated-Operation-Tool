# Issue 017 Chrome / Edge 侧载与配对

## 生成开发包

```powershell
npm ci
npm run build:clipper
```

输出：

- `out/clipper/chrome-unpacked`
- `out/clipper/edge-unpacked`
- 两个确定性 ZIP 和 `SHA256SUMS`

## Chrome 侧载

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，选中 `out/clipper/chrome-unpacked`。

## Edge 侧载

1. 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 选择“加载解压缩的扩展”，选中 `out/clipper/edge-unpacked`。

两者使用相同源码和合同；Edge 包只改变展示名称。

## Windows 真实浏览器复验

在已安装 Chrome 和 Edge 的 Windows 10/11 主机上运行：

```powershell
npm run test:clipper-real
```

脚本为两款浏览器分别创建随机临时 profile，使用动态 CDP 端口和仅限本机的合成公开页面完成
侧载、配对、采集、保存、桌面读取、幂等重放与离线提示验证。它不会读取或修改默认浏览器
profile，也不会访问真实业务站点、模型或付费 API；结束后会清理浏览器进程、监听器、临时
数据库和 profile。

日常使用可点击浏览器工具栏中的扩展。扩展还声明了默认动作键 `Alt+Shift+Y`，可在浏览器
扩展快捷键设置中查看或修改；真实 smoke 会确认该命令在隔离 profile 中实际生效。

## 配对与收藏

1. 在桌面应用设置中选择 ProjectDataRoot，显式开启本地 API。
2. 点击“开始配对”，复制显示的 endpoint 和短期配对码。
3. 点击浏览器工具栏中的扩展，填写 endpoint、配对码和本机客户端标签后配对。
4. 打开一个无需登录的公开 HTTP/HTTPS 页面，选择需要的文字，再次点击扩展。
5. 手工填写平台、账号、发布时间、可见互动数、标签和备注。
6. 确认这是公开页面。截图默认关闭；需要时显式勾选，仅保存当前可见区域。
7. 点击保存。桌面任务页的“收藏样本”区域可只读查看样本和截图。

不要在带 token、session、signature 等凭据 query 的 URL 上使用；扩展会拒绝此类页面。
关闭桌面本地 API 后，扩展显示离线且不会改用公网或扫描其他端口。卸载扩展可删除浏览器
保存的本地 token；桌面中撤销客户端可立即使旧 token 失效。
