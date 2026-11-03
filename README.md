# tianting-admin

天听管理后台 H5（业务运营）。**天听**是自研 IM 平台，替换腾讯 IM（聊天、群聊、聊天室、站内推送）。

业务运营用的管理后台：用户、群、消息查询与删除、禁言、封禁、系统通知、审计。

| | |
|---|---|
| 状态 | 尚未开始，排在工作队列 Q14、Q15 |
| 技术 | React，只调用后台服务（console-server，部署在内网 / VPN 后），**浏览器里永远不放管理密钥** |
| 服务端、协议、需求文档 | [tianting-server](https://github.com/leetonny001/tianting-server) |
| 工作队列 / 日报 | tianting-server 的 `docs/process/QUEUE.md`、`docs/reports/daily/` |

需求：tianting-server 的 `docs/prd/PRD-admin`，拍板项见 `docs/review/DECISIONS-2026-11-03.md`（X-1～X-9 待定）。

## 天听的项目

| 仓库 | 内容 |
|---|---|
| [tianting-server](https://github.com/leetonny001/tianting-server) | Go 服务端、协议、需求 / 架构 / 测试文档 |
| [tianting-sdk-ts](https://github.com/leetonny001/tianting-sdk-ts) | SDK（TypeScript）：H5、PC |
| [tianting-sdk-kotlin](https://github.com/leetonny001/tianting-sdk-kotlin) | SDK（Kotlin）：Android |
| [tianting-sdk-swift](https://github.com/leetonny001/tianting-sdk-swift) | SDK（Swift）：iOS |
| [tianting-web](https://github.com/leetonny001/tianting-web) | H5 客户端 |
| [tianting-desktop](https://github.com/leetonny001/tianting-desktop) | PC 客户端 |
| [tianting-android](https://github.com/leetonny001/tianting-android) | Android 客户端 |
| [tianting-ios](https://github.com/leetonny001/tianting-ios) | iOS 客户端 |
| [tianting-admin](https://github.com/leetonny001/tianting-admin) | 管理后台 H5 |
| [tianting-ops](https://github.com/leetonny001/tianting-ops) | 运维后台 H5 |
