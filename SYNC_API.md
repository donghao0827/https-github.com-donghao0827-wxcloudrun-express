# 囍伴云同步 API

服务使用微信云托管注入的 `X-WX-OPENID` 识别用户。业务接口必须通过
`wx.cloud.callContainer` 调用，不接受客户端自行提交用户 ID。

## 环境变量

- `MYSQL_ADDRESS`
- `MYSQL_USERNAME`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`：可选，默认 `nodejs_demo`
- `DEV_OPENID`：仅用于本地开发，生产环境不要配置

## 接口

- `GET /health`：健康检查
- `GET /api/profile`：获取当前微信用户的姓名、身份和婚礼 ID
- `POST /api/weddings/create`：创建婚礼并由服务端生成婚礼 ID
- `GET /api/weddings/preview/:weddingId`：加入前确认婚期和已有成员
- `POST /api/weddings/join`：通过婚礼 ID 加入已有婚礼
- `GET /api/sync`：获取当前用户的云端备婚快照
- `PUT /api/sync`：提交 `payload` 和 `baseVersion` 更新数据
- `DELETE /api/sync`：删除当前用户的云端数据
- `GET /api/wx_openid`：检查微信身份注入

同步内容按婚礼 ID 归属，包括婚礼信息、筹备任务、婚品、预算和宾客名单。
新郎和新娘绑定相同婚礼 ID 后读写同一份数据。结婚照当前仍保存在小程序本地，
不会通过此接口上传。

## 首次部署

当前没有正式用户时，建议删除旧模板表后重新部署，由 Sequelize 按新模型建表：

```sql
DROP TABLE IF EXISTS wedding_snapshots;
DROP TABLE IF EXISTS wedding_invites;
DROP TABLE IF EXISTS wedding_members;
DROP TABLE IF EXISTS weddings;
DROP TABLE IF EXISTS counters;
```

## 成员与权限

- `owner`：管理员，可邀请、管理成员及编辑全部筹备数据。
- `editor`：协作者，可查看和编辑筹备数据。
- `viewer`：只读成员，只能读取云端数据。

加入婚礼改为一次性邀请码：

- `GET /api/invites/preview/:inviteCode`：查看邀请身份、权限和婚礼信息。
- `POST /api/invites/join`：使用邀请码加入婚礼。
- `GET /api/members`：获取当前婚礼成员。
- `POST /api/invites`：管理员生成 7 天有效的一次性邀请码。
- `PATCH /api/members/:id`：管理员调整成员身份或权限。
- `DELETE /api/members/:id`：管理员移除成员。

不要在已有正式用户后执行上述 SQL。
