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
- `POST /api/profile/bind`：首次绑定姓名、身份和婚礼 ID
- `GET /api/sync`：获取当前用户的云端备婚快照
- `PUT /api/sync`：提交 `payload` 和 `baseVersion` 更新数据
- `DELETE /api/sync`：删除当前用户的云端数据
- `GET /api/wx_openid`：检查微信身份注入

同步内容按婚礼 ID 归属，包括婚礼信息、筹备任务、婚品、预算和宾客名单。
新郎和新娘绑定相同婚礼 ID 后读写同一份数据。结婚照当前仍保存在小程序本地，
不会通过此接口上传。
