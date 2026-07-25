-- 囍伴成员权限 V2
-- 当前尚无正式用户时执行。会清除婚礼、成员及所有测试同步数据。
-- 执行完成后立即部署新版云托管服务，服务启动时会自动创建新表。

DROP TABLE IF EXISTS wedding_invites;
DROP TABLE IF EXISTS wedding_snapshots;
DROP TABLE IF EXISTS wedding_members;
DROP TABLE IF EXISTS weddings;
