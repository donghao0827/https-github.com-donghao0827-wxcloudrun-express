const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const {
  init: initDB,
  sequelize,
  Wedding,
  WeddingSnapshot,
  WeddingMember,
  WeddingInvite,
} = require("./db");

const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(cors());
app.use(morgan("tiny"));

function getOpenId(req) {
  return (
    req.headers["x-wx-openid"] ||
    req.headers["x-wx-from-openid"] ||
    (process.env.NODE_ENV === "development" && process.env.DEV_OPENID) ||
    ""
  );
}

function requireWeChatUser(req, res, next) {
  const openid = getOpenId(req);
  if (!openid) {
    return res.status(401).send({
      code: 401,
      message: "未获取到微信用户身份，请通过 wx.cloud.callContainer 调用",
    });
  }
  req.openid = openid;
  next();
}

async function requireWeddingMember(req, res, next) {
  try {
    const openid = getOpenId(req);
    if (!openid) {
      return res.status(401).send({
        code: 401,
        message: "未获取到微信用户身份，请通过 wx.cloud.callContainer 调用",
      });
    }
    const member = await WeddingMember.findOne({
      where: { openid, status: "active" },
    });
    if (!member) {
      return res.status(403).send({
        code: 403,
        message: "请先填写基础信息并绑定婚礼 ID",
      });
    }
    req.openid = openid;
    req.member = member;
    next();
  } catch (error) {
    next(error);
  }
}

function requireEditor(req, res, next) {
  if (!["owner", "editor"].includes(req.member.permissionRole)) {
    return res.status(403).send({
      code: 403,
      message: "你当前是只读成员，不能修改婚礼数据",
    });
  }
  next();
}

function requireOwner(req, res, next) {
  if (req.member.permissionRole !== "owner") {
    return res.status(403).send({
      code: 403,
      message: "仅新郎或新娘管理员可以进行此操作",
    });
  }
  next();
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "同步数据格式不正确";
  }
  const allowedKeys = ["wedding", "tasks", "materials", "budgets", "guests"];
  const unknownKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.includes(key)
  );
  if (unknownKeys.length) return `包含不支持的字段：${unknownKeys.join(", ")}`;
  if (JSON.stringify(payload).length > 800000) return "同步数据超过大小限制";
  return "";
}

function publicMember(member) {
  return {
    id: member.id,
    name: member.name,
    relation: member.relation,
    role: member.relation,
    permissionRole: member.permissionRole,
    status: member.status,
    weddingId: member.weddingId,
  };
}

function publicWedding(wedding) {
  return {
    weddingId: wedding.weddingId,
    date: wedding.weddingDate,
    city: wedding.city,
    venue: wedding.venue,
  };
}

async function generateWeddingId(transaction) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let weddingId = "";
    for (let index = 0; index < 8; index += 1) {
      weddingId += chars[crypto.randomInt(chars.length)];
    }
    const exists = await Wedding.count({ where: { weddingId }, transaction });
    if (!exists) return weddingId;
  }
  throw new Error("暂时无法生成婚礼 ID，请稍后重试");
}

function validateMemberInput(body, options = {}) {
  const name = String(body.name || "").trim();
  const relation = String(body.relation || "").trim();
  if (name.length < 1 || name.length > 20) return "姓名需为 1—20 个字符";
  if (relation.length < 1 || relation.length > 30) return "请选择或填写成员身份";
  if (options.coupleOnly && !["新郎", "新娘"].includes(relation)) {
    return "创建婚礼时请选择新郎或新娘";
  }
  return "";
}

async function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let inviteCode = "";
    for (let index = 0; index < 10; index += 1) {
      inviteCode += chars[crypto.randomInt(chars.length)];
    }
    if (!(await WeddingInvite.count({ where: { inviteCode } }))) return inviteCode;
  }
  throw new Error("暂时无法生成邀请码，请稍后重试");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.send({ code: 0, message: "xiban-api is running" });
});

app.get("/api/profile", requireWeChatUser, async (req, res, next) => {
  try {
    const member = await WeddingMember.findOne({
      where: { openid: req.openid, status: "active" },
    });
    const wedding = member
      ? await Wedding.findOne({ where: { weddingId: member.weddingId } })
      : null;
    res.send({
      code: 0,
      data: member
        ? {
            ...publicMember(member),
            wedding: wedding ? publicWedding(wedding) : null,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/weddings/create", requireWeChatUser, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const name = String(req.body.name || "").trim();
    const relation = String(req.body.relation || "").trim();
    const weddingDate = String(req.body.date || "").trim();
    const city = String(req.body.city || "").trim();
    const venue = String(req.body.venue || "").trim();
    const validationError = validateMemberInput(
      { name, relation },
      { coupleOnly: true }
    );
    if (validationError) {
      await transaction.rollback();
      return res.status(400).send({ code: 400, message: validationError });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weddingDate)) {
      await transaction.rollback();
      return res.status(400).send({
        code: 400,
        message: "请选择婚礼日期",
      });
    }
    const existingMember = await WeddingMember.findOne({
      where: { openid: req.openid },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existingMember) {
      await transaction.rollback();
      return res.status(409).send({
        code: 409,
        message: `当前账号已绑定婚礼 ${existingMember.weddingId}`,
      });
    }
    const weddingId = await generateWeddingId(transaction);
    const wedding = await Wedding.create(
      { weddingId, weddingDate, city, venue },
      { transaction }
    );
    const member = await WeddingMember.create(
      {
        openid: req.openid,
        weddingId,
        name,
        relation,
        permissionRole: "owner",
        status: "active",
      },
      { transaction }
    );

    const members = await WeddingMember.findAll({
      where: { weddingId },
      transaction,
    });
    const sortedMembers = members.sort((left, right) => {
      const order = { 新娘: 0, 新郎: 1 };
      return (order[left.relation] ?? 9) - (order[right.relation] ?? 9);
    });
    const couple = sortedMembers.map(item => item.name).join(" & ");
    const snapshot = await WeddingSnapshot.findOne({
      where: { weddingId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (snapshot && snapshot.payload) {
      snapshot.payload = {
        ...snapshot.payload,
        wedding: {
          ...(snapshot.payload.wedding || {}),
          couple,
        },
      };
      snapshot.version += 1;
      await snapshot.save({ transaction });
    }

    await transaction.commit();
    res.send({
      code: 0,
      data: {
        profile: publicMember(member),
        wedding: publicWedding(wedding),
        members: sortedMembers.map(item => ({
          id: item.id,
          name: item.name,
          relation: item.relation,
          role: item.relation,
          permissionRole: item.permissionRole,
        })),
      },
    });
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
});

app.get("/api/invites/preview/:inviteCode", requireWeChatUser, async (req, res, next) => {
  try {
    const inviteCode = String(req.params.inviteCode || "").trim().toUpperCase();
    const invite = await WeddingInvite.findOne({
      where: { inviteCode, status: "active" },
    });
    if (!invite || new Date(invite.expiresAt) <= new Date()) {
      return res.status(404).send({
        code: 404,
        message: "邀请码不存在或已失效",
      });
    }
    const wedding = await Wedding.findOne({
      where: { weddingId: invite.weddingId },
    });
    const members = await WeddingMember.findAll({
      where: { weddingId: invite.weddingId, status: "active" },
      attributes: ["id", "name", "relation", "permissionRole"],
    });
    res.send({
      code: 0,
      data: {
        wedding: publicWedding(wedding),
        invite: {
          relation: invite.relation,
          permissionRole: invite.permissionRole,
          expiresAt: invite.expiresAt,
        },
        members: members.map(publicMember),
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/invites/join", requireWeChatUser, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const name = String(req.body.name || "").trim();
    const inviteCode = String(req.body.inviteCode || "").trim().toUpperCase();
    const validationError = validateMemberInput({ name, relation: "受邀成员" });
    if (validationError) {
      await transaction.rollback();
      return res.status(400).send({ code: 400, message: validationError });
    }
    if (!/^[A-Z0-9]{10}$/.test(inviteCode)) {
      await transaction.rollback();
      return res.status(400).send({
        code: 400,
        message: "请输入 10 位邀请码",
      });
    }
    const existingMember = await WeddingMember.findOne({
      where: { openid: req.openid },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existingMember) {
      await transaction.rollback();
      return res.status(409).send({
        code: 409,
        message: `当前账号已绑定婚礼 ${existingMember.weddingId}`,
      });
    }
    const invite = await WeddingInvite.findOne({
      where: { inviteCode, status: "active" },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!invite || new Date(invite.expiresAt) <= new Date()) {
      await transaction.rollback();
      return res.status(404).send({ code: 404, message: "邀请码不存在或已失效" });
    }
    const weddingId = invite.weddingId;
    const wedding = await Wedding.findOne({ where: { weddingId }, transaction });
    const member = await WeddingMember.create(
      {
        openid: req.openid,
        weddingId,
        name,
        relation: invite.relation,
        permissionRole: invite.permissionRole,
        status: "active",
      },
      { transaction }
    );
    invite.status = "used";
    invite.usedBy = member.id;
    await invite.save({ transaction });
    const members = await WeddingMember.findAll({
      where: { weddingId, status: "active" },
      transaction,
    });
    const sortedMembers = members.sort((left, right) => {
      const order = { 新娘: 0, 新郎: 1 };
      return (order[left.relation] ?? 9) - (order[right.relation] ?? 9);
    });
    const couple = sortedMembers
      .filter(item => ["新娘", "新郎"].includes(item.relation))
      .map(item => item.name)
      .join(" & ");
    const snapshot = await WeddingSnapshot.findOne({
      where: { weddingId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (snapshot && snapshot.payload) {
      snapshot.payload = {
        ...snapshot.payload,
        wedding: {
          ...(snapshot.payload.wedding || {}),
          couple,
        },
      };
      snapshot.version += 1;
      await snapshot.save({ transaction });
    }
    await transaction.commit();
    res.send({
      code: 0,
      data: {
        profile: publicMember(member),
        wedding: publicWedding(wedding),
        members: sortedMembers.map(item => ({
          id: item.id,
          name: item.name,
          relation: item.relation,
          role: item.relation,
          permissionRole: item.permissionRole,
        })),
      },
    });
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
});

app.get("/api/members", requireWeddingMember, async (req, res, next) => {
  try {
    const members = await WeddingMember.findAll({
      where: { weddingId: req.member.weddingId, status: "active" },
      order: [["id", "ASC"]],
    });
    res.send({
      code: 0,
      data: members.map(member => ({
        ...publicMember(member),
        isMe: member.id === req.member.id,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/invites",
  requireWeddingMember,
  requireOwner,
  async (req, res, next) => {
    try {
      const relation = String(req.body.relation || "").trim();
      const permissionRole = String(req.body.permissionRole || "").trim();
      if (!relation || relation.length > 30) {
        return res.status(400).send({ code: 400, message: "请填写受邀人的身份" });
      }
      if (!["owner", "editor", "viewer"].includes(permissionRole)) {
        return res.status(400).send({ code: 400, message: "邀请权限不正确" });
      }
      if (permissionRole === "owner" && !["新娘", "新郎"].includes(relation)) {
        return res.status(400).send({
          code: 400,
          message: "只有新郎或新娘可以被邀请为管理员",
        });
      }
      if (["新娘", "新郎"].includes(relation)) {
        const existingCoupleMember = await WeddingMember.count({
          where: {
            weddingId: req.member.weddingId,
            relation,
            status: "active",
          },
        });
        const existingCoupleInvite = await WeddingInvite.count({
          where: {
            weddingId: req.member.weddingId,
            relation,
            status: "active",
          },
        });
        if (existingCoupleMember || existingCoupleInvite) {
          return res.status(409).send({
            code: 409,
            message: `该婚礼已有${relation}或有效邀请`,
          });
        }
      }
      const inviteCode = await generateInviteCode();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const invite = await WeddingInvite.create({
        inviteCode,
        weddingId: req.member.weddingId,
        relation,
        permissionRole,
        expiresAt,
        createdBy: req.member.id,
      });
      res.send({
        code: 0,
        data: {
          inviteCode: invite.inviteCode,
          relation: invite.relation,
          permissionRole: invite.permissionRole,
          expiresAt: invite.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

app.patch(
  "/api/members/:id",
  requireWeddingMember,
  requireOwner,
  async (req, res, next) => {
    try {
      const member = await WeddingMember.findOne({
        where: {
          id: req.params.id,
          weddingId: req.member.weddingId,
          status: "active",
        },
      });
      if (!member) {
        return res.status(404).send({ code: 404, message: "没有找到该成员" });
      }
      if (member.id === req.member.id) {
        return res.status(400).send({ code: 400, message: "不能修改自己的管理员权限" });
      }
      const relation = String(req.body.relation || member.relation).trim();
      const permissionRole = String(
        req.body.permissionRole || member.permissionRole
      ).trim();
      if (!relation || relation.length > 30) {
        return res.status(400).send({ code: 400, message: "成员身份不正确" });
      }
      if (!["owner", "editor", "viewer"].includes(permissionRole)) {
        return res.status(400).send({ code: 400, message: "成员权限不正确" });
      }
      if (permissionRole === "owner" && !["新娘", "新郎"].includes(relation)) {
        return res.status(400).send({
          code: 400,
          message: "只有新郎或新娘可以设为管理员",
        });
      }
      member.relation = relation;
      member.permissionRole = permissionRole;
      await member.save();
      res.send({ code: 0, data: publicMember(member) });
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  "/api/members/:id",
  requireWeddingMember,
  requireOwner,
  async (req, res, next) => {
    try {
      const member = await WeddingMember.findOne({
        where: {
          id: req.params.id,
          weddingId: req.member.weddingId,
          status: "active",
        },
      });
      if (!member) {
        return res.status(404).send({ code: 404, message: "没有找到该成员" });
      }
      if (member.id === req.member.id) {
        return res.status(400).send({ code: 400, message: "不能移除自己" });
      }
      member.status = "removed";
      member.openid = `removed_${member.id}_${Date.now()}`;
      await member.save();
      res.send({ code: 0, message: "成员已移除" });
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/sync", requireWeddingMember, async (req, res, next) => {
  try {
    const snapshot = await WeddingSnapshot.findOne({
      where: { weddingId: req.member.weddingId },
    });
    if (snapshot && snapshot.payload) {
      const members = await WeddingMember.findAll({
        where: { weddingId: req.member.weddingId, status: "active" },
      });
      const roleOrder = { 新娘: 0, 新郎: 1 };
      const couple = members
        .filter(item => ["新娘", "新郎"].includes(item.relation))
        .sort(
          (left, right) =>
            roleOrder[left.relation] - roleOrder[right.relation]
        )
        .map(item => item.name)
        .filter(Boolean)
        .join(" & ");
      const currentCouple =
        snapshot.payload.wedding && snapshot.payload.wedding.couple;
      if (couple && currentCouple !== couple) {
        snapshot.payload = {
          ...snapshot.payload,
          wedding: {
            ...(snapshot.payload.wedding || {}),
            couple,
          },
        };
        snapshot.version += 1;
        await snapshot.save();
      }
    }
    res.send({
      code: 0,
      data: snapshot
        ? {
            version: snapshot.version,
            updatedAt: snapshot.updatedAt,
            payload: snapshot.payload,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/sync", requireWeddingMember, requireEditor, async (req, res, next) => {
  try {
    const { payload, baseVersion = 0 } = req.body;
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).send({ code: 400, message: validationError });
    }

    let snapshot = await WeddingSnapshot.findOne({
      where: { weddingId: req.member.weddingId },
    });

    if (snapshot && Number(baseVersion) !== snapshot.version) {
      return res.status(409).send({
        code: 409,
        message: "云端数据已更新，请先拉取最新数据",
        data: {
          version: snapshot.version,
          updatedAt: snapshot.updatedAt,
          payload: snapshot.payload,
        },
      });
    }

    if (!snapshot) {
      snapshot = await WeddingSnapshot.create({
        weddingId: req.member.weddingId,
        version: 1,
        payload,
      });
    } else {
      snapshot.version += 1;
      snapshot.payload = payload;
      await snapshot.save();
    }

    res.send({
      code: 0,
      data: {
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/sync", requireWeddingMember, requireOwner, async (req, res, next) => {
  try {
    const memberCount = await WeddingMember.count({
      where: { weddingId: req.member.weddingId },
    });
    if (memberCount > 1) {
      return res.status(409).send({
        code: 409,
        message: "该婚礼已有多位成员，不能直接删除共享数据",
      });
    }
    await WeddingSnapshot.destroy({
      where: { weddingId: req.member.weddingId },
    });
    res.send({ code: 0, message: "云端备婚数据已删除" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/wx_openid", requireWeChatUser, (req, res) => {
  res.send({ code: 0, data: { openid: req.openid } });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send({
    code: 500,
    message: "服务暂时不可用，请稍后重试",
  });
});

const port = process.env.PORT || 80;

async function bootstrap() {
  await initDB();
  app.listen(port, () => {
    console.log(`囍伴云同步服务已启动，端口 ${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("服务启动失败", error);
  process.exit(1);
});
