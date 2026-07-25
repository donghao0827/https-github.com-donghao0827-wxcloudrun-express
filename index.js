const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const {
  init: initDB,
  sequelize,
  WeddingSnapshot,
  WeddingMember,
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
    const member = await WeddingMember.findOne({ where: { openid } });
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.send({ code: 0, message: "xiban-api is running" });
});

app.get("/api/profile", requireWeChatUser, async (req, res, next) => {
  try {
    const member = await WeddingMember.findOne({
      where: { openid: req.openid },
    });
    res.send({
      code: 0,
      data: member
        ? {
            name: member.name,
            role: member.role,
            weddingId: member.weddingId,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/profile/bind", requireWeChatUser, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const name = String(req.body.name || "").trim();
    const role = String(req.body.role || "").trim();
    const weddingId = String(req.body.weddingId || "").trim().toUpperCase();

    if (name.length < 1 || name.length > 20) {
      await transaction.rollback();
      return res.status(400).send({ code: 400, message: "姓名需为 1—20 个字符" });
    }
    if (!["新郎", "新娘"].includes(role)) {
      await transaction.rollback();
      return res.status(400).send({ code: 400, message: "请选择新郎或新娘" });
    }
    if (!/^[A-Z0-9]{6,16}$/.test(weddingId)) {
      await transaction.rollback();
      return res.status(400).send({
        code: 400,
        message: "婚礼 ID 需为 6—16 位英文字母或数字",
      });
    }

    const existingMember = await WeddingMember.findOne({
      where: { openid: req.openid },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existingMember && existingMember.weddingId !== weddingId) {
      await transaction.rollback();
      return res.status(409).send({
        code: 409,
        message: `当前账号已绑定婚礼 ${existingMember.weddingId}`,
      });
    }

    const occupiedRole = await WeddingMember.findOne({
      where: { weddingId, role },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (occupiedRole && occupiedRole.openid !== req.openid) {
      await transaction.rollback();
      return res.status(409).send({
        code: 409,
        message: `该婚礼的${role}已绑定其他微信账号`,
      });
    }

    let member = existingMember;
    if (member) {
      member.name = name;
      member.role = role;
      await member.save({ transaction });
    } else {
      member = await WeddingMember.create(
        { openid: req.openid, weddingId, name, role },
        { transaction }
      );
    }
    await transaction.commit();
    res.send({
      code: 0,
      data: { name: member.name, role: member.role, weddingId: member.weddingId },
    });
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
});

app.get("/api/sync", requireWeddingMember, async (req, res, next) => {
  try {
    const snapshot = await WeddingSnapshot.findOne({
      where: { weddingId: req.member.weddingId },
    });
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

app.put("/api/sync", requireWeddingMember, async (req, res, next) => {
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

app.delete("/api/sync", requireWeddingMember, async (req, res, next) => {
  try {
    const memberCount = await WeddingMember.count({
      where: { weddingId: req.member.weddingId },
    });
    if (memberCount > 1) {
      return res.status(409).send({
        code: 409,
        message: "该婚礼已有两位成员，不能单方面删除共享数据",
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
