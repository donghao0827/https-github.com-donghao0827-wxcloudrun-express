const test = require("node:test");
const assert = require("node:assert/strict");
const { LIMITS, isOwnedCloudFileId, validatePayload } = require("../validation");

const weddingId = "ABC23456";

function validPayload() {
  return {
    wedding: { couple: "小满 & 小安", date: "2026-10-18", city: "杭州", venue: "西湖国宾馆" },
    tasks: [{ id: "tpl_wedding-start", title: "确定婚礼日期", category: "前期规划", stage: "婚礼启动", dueDate: "2026-08-14", done: false, checklist: ["双方确认日期"], dependencies: [] }],
    materials: [{ id: "tm1", title: "新娘婚纱", category: "新人礼服", bought: false, quantity: 1, unit: "件", note: "", plannedAmount: 5000, spentAmount: 0, image: "bridal-dress", customImage: "" }],
    budgets: [{ id: "budget_1", category: "礼服造型", planned: 10000, spent: 5000, expenses: [{ id: "expense_1", name: "婚纱定金", amount: 5000, date: "2026-08-01", payer: "新娘", note: "", createdBy: "小满", createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z" }] }],
    guests: [{ id: "guest_1", name: "张叔叔", side: "男方", group: "亲友", count: 2, status: "已确认" }],
    records: [{ id: "record_1", title: "购买婚纱", date: "2026-08-01", category: "婚品采购", amount: 5000, quantity: 1, unitPrice: 5000, materialCategory: "新人礼服", materialTitle: "新娘婚纱", materialId: "tm1", taskId: "", bought: true, note: "", photos: [], createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z" }],
    photo: `cloud://env/weddings/${weddingId}/photos/display.jpg`,
    photoOriginal: `cloud://env/weddings/${weddingId}/photos/original.jpg`,
    photoDisplay: { mode: "aspectFill" },
  };
}

test("accepts the current mini-program payload", () => {
  assert.equal(validatePayload(validPayload(), weddingId), "");
});

test("rejects impossible dates and unsafe money values", () => {
  const badDate = validPayload();
  badDate.wedding.date = "2026-02-30";
  assert.match(validatePayload(badDate, weddingId), /日期/);
  const badMoney = validPayload();
  badMoney.budgets[0].planned = Infinity;
  assert.match(validatePayload(badMoney, weddingId), /金额/);
});

test("rejects malformed ids and guest counts", () => {
  const badId = validPayload();
  badId.tasks[0].id = "../../other";
  assert.match(validatePayload(badId, weddingId), /ID/);
  const badCount = validPayload();
  badCount.guests[0].count = 1.5;
  assert.match(validatePayload(badCount, weddingId), /人数/);
});

test("rejects oversized collections and text", () => {
  const tooMany = validPayload();
  tooMany.tasks = Array.from({ length: LIMITS.tasks + 1 }, () => tooMany.tasks[0]);
  assert.match(validatePayload(tooMany, weddingId), /数量超过上限/);
  const longTitle = validPayload();
  longTitle.records[0].title = "喜".repeat(121);
  assert.match(validatePayload(longTitle, weddingId), /名称/);
});

test("only accepts cloud files owned by the current wedding", () => {
  assert.equal(isOwnedCloudFileId(`cloud://env/weddings/${weddingId}/avatars/me.jpg`, weddingId, "avatars"), true);
  const foreign = validPayload();
  foreign.records[0].photos = ["cloud://env/weddings/OTHER123/records/photo.jpg"];
  assert.match(validatePayload(foreign, weddingId), /不属于当前婚礼/);
});

test("limits custom material images in the free cloud experience", () => {
  const payload = validPayload();
  payload.materials = Array.from({ length: LIMITS.customMaterialImages + 1 }, (_, index) => ({
    ...payload.materials[0],
    id: `material_${index}`,
    customImage: `cloud://env/weddings/${weddingId}/materials/${index}.jpg`,
  }));
  assert.match(validatePayload(payload, weddingId), /自定义婚品图片超过体验上限/);
});
