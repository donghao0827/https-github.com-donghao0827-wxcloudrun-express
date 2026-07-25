const { Sequelize, DataTypes } = require("sequelize");

const {
  MYSQL_USERNAME,
  MYSQL_PASSWORD,
  MYSQL_ADDRESS = "",
  MYSQL_DATABASE = "nodejs_demo",
} = process.env;

const [host, port] = MYSQL_ADDRESS.split(":");

const sequelize = new Sequelize(MYSQL_DATABASE, MYSQL_USERNAME, MYSQL_PASSWORD, {
  host,
  port,
  dialect: "mysql",
  logging: process.env.NODE_ENV === "development" ? console.log : false,
  define: { underscored: true },
  pool: { max: 8, min: 0, acquire: 30000, idle: 10000 },
});

const Wedding = sequelize.define(
  "Wedding",
  {
    weddingId: {
      type: DataTypes.STRING(16),
      allowNull: false,
      unique: true,
    },
    weddingDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    city: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "",
    },
    venue: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: "",
    },
  },
  { tableName: "weddings" }
);

const WeddingSnapshot = sequelize.define(
  "WeddingSnapshot",
  {
    weddingId: {
      type: DataTypes.STRING(16),
      allowNull: false,
      unique: true,
    },
    version: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: false,
    },
  },
  { tableName: "wedding_snapshots" }
);

const WeddingMember = sequelize.define(
  "WeddingMember",
  {
    openid: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    weddingId: {
      type: DataTypes.STRING(16),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    relation: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    permissionRole: {
      type: DataTypes.ENUM("owner", "editor", "viewer"),
      allowNull: false,
      defaultValue: "viewer",
    },
    status: {
      type: DataTypes.ENUM("active", "removed"),
      allowNull: false,
      defaultValue: "active",
    },
  },
  {
    tableName: "wedding_members",
    indexes: [
      {
        fields: ["wedding_id", "relation"],
      },
    ],
  }
);

const WeddingInvite = sequelize.define(
  "WeddingInvite",
  {
    inviteCode: {
      type: DataTypes.STRING(16),
      allowNull: false,
      unique: true,
    },
    weddingId: {
      type: DataTypes.STRING(16),
      allowNull: false,
    },
    relation: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    permissionRole: {
      type: DataTypes.ENUM("owner", "editor", "viewer"),
      allowNull: false,
      defaultValue: "editor",
    },
    status: {
      type: DataTypes.ENUM("active", "used", "revoked"),
      allowNull: false,
      defaultValue: "active",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    usedBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
  },
  { tableName: "wedding_invites" }
);

async function init() {
  await sequelize.authenticate();
  await Wedding.sync();
  await WeddingMember.sync();
  await WeddingInvite.sync();
  await WeddingSnapshot.sync();
}

module.exports = {
  init,
  sequelize,
  Wedding,
  WeddingSnapshot,
  WeddingMember,
  WeddingInvite,
};
