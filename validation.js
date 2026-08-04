const LIMITS = Object.freeze({
  payloadBytes: 800000,
  tasks: 500,
  materials: 500,
  budgets: 50,
  expensesPerBudget: 1000,
  guests: 1000,
  records: 2000,
  checklist: 50,
  photosPerRecord: 3,
  customMaterialImages: 20,
  money: 100000000,
  quantity: 100000,
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOwnedCloudFileId(fileId, weddingId, folderPattern = "(?:photos|materials|records)") {
  if (typeof fileId !== "string" || fileId.length > 512) return false;
  const pattern = new RegExp(
    `^cloud://[^/]+/weddings/${escapeRegExp(weddingId)}/${folderPattern}/[^/]+$`,
    "i"
  );
  return pattern.test(fileId) && !fileId.includes("..");
}

function collectCloudFileIds(value, result = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("cloud://")) result.add(value);
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectCloudFileIds(item, result));
    return result;
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach(item => collectCloudFileIds(item, result));
  }
  return result;
}

function validText(value, max, required = false) {
  if (value === undefined || value === null) return !required;
  if (typeof value !== "string" || value.length > max) return false;
  return !required || value.trim().length > 0;
}

function validId(value, required = true) {
  if (value === undefined || value === null || value === "") return !required;
  return typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(value);
}

function validNumber(value, min, max, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value < min || value > max) return false;
  return !integer || Number.isInteger(value);
}

function validOptionalNumber(value, min, max, integer = false) {
  return value === undefined || validNumber(value, min, max, integer);
}

function validBoolean(value) {
  return value === undefined || typeof value === "boolean";
}

function validDate(value) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validTimestamp(value) {
  if (value === undefined || value === null || value === "") return true;
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function validateList(value, name, max, validator) {
  if (!Array.isArray(value)) return `${name}格式不正确`;
  if (value.length > max) return `${name}数量超过上限（${max}）`;
  for (let index = 0; index < value.length; index += 1) {
    const error = validator(value[index], index);
    if (error) return `${name}第 ${index + 1} 项${error}`;
  }
  return "";
}

function validateWedding(value) {
  if (!isPlainObject(value)) return "婚礼信息格式不正确";
  if (!validText(value.couple, 100)) return "婚礼名称过长";
  if (!validDate(value.date)) return "婚礼日期不合法";
  if (!validText(value.city, 60) || !validText(value.venue, 160)) return "婚礼地点过长";
  if (value.plan !== undefined && !isPlainObject(value.plan)) return "婚礼计划格式不正确";
  return "";
}

function validateTask(item) {
  if (!isPlainObject(item)) return "格式不正确";
  if (!validId(item.id)) return "的 ID 不合法";
  if (!validText(item.title, 120, true)) return "的名称不合法";
  if (!validText(item.category, 40) || !validText(item.stage, 40)) return "的分类或阶段过长";
  if (!validDate(item.dueDate) || !validDate(item.manualDueDate)) return "的日期不合法";
  if (!validBoolean(item.done) || !validBoolean(item.optional) || !validBoolean(item.manuallyScheduled)) return "的完成状态不合法";
  if (!validOptionalNumber(item.idealDaysBefore, 0, 3650, true) || !validOptionalNumber(item.latestDaysBefore, 0, 3650, true)) return "的时间规划不合法";
  if (item.checklist !== undefined) {
    if (!Array.isArray(item.checklist) || item.checklist.length > LIMITS.checklist) return "的明细数量过多";
    if (item.checklist.some(text => !validText(text, 240, true))) return "的明细内容不合法";
  }
  if (item.dependencies !== undefined) {
    if (!Array.isArray(item.dependencies) || item.dependencies.length > 50 || item.dependencies.some(id => !validId(id))) return "的依赖任务不合法";
  }
  return "";
}

function validateMaterial(item) {
  if (!isPlainObject(item)) return "格式不正确";
  if (!validId(item.id) || !validText(item.title, 100, true)) return "的 ID 或名称不合法";
  if (!validText(item.category, 40) || !validText(item.unit, 16) || !validText(item.note, 500)) return "的文本内容过长";
  if (!validBoolean(item.bought)) return "的购买状态不合法";
  if (!validOptionalNumber(item.quantity, 0, LIMITS.quantity) || !validOptionalNumber(item.plannedAmount, 0, LIMITS.money) || !validOptionalNumber(item.spentAmount, 0, LIMITS.money)) return "的数量或金额不合法";
  if (!validText(item.image, 160) || !validText(item.customImage, 512)) return "的图片地址不合法";
  return "";
}

function validateExpense(item) {
  if (!isPlainObject(item)) return "格式不正确";
  if (!validId(item.id) || !validId(item.recordId, false)) return "的 ID 不合法";
  if (!validText(item.name, 100, true) || !validText(item.payer, 60) || !validText(item.note, 500) || !validText(item.createdBy, 100)) return "的文本内容不合法";
  if (!validNumber(item.amount, 0, LIMITS.money) || !validDate(item.date)) return "的金额或日期不合法";
  if (!validTimestamp(item.createdAt) || !validTimestamp(item.updatedAt)) return "的更新时间不合法";
  return "";
}

function validateBudget(item) {
  if (!isPlainObject(item)) return "格式不正确";
  if (!validId(item.id) || !validText(item.category, 40, true)) return "的 ID 或分类不合法";
  if (!validNumber(item.planned, 0, LIMITS.money) || !validOptionalNumber(item.spent, 0, LIMITS.money)) return "的金额不合法";
  const error = validateList(item.expenses, "支出", LIMITS.expensesPerBudget, validateExpense);
  return error ? `中的${error}` : "";
}

function validateGuest(item) {
  if (!isPlainObject(item)) return "格式不正确";
  if (!validId(item.id) || !validText(item.name, 100, true)) return "的 ID 或称呼不合法";
  if (!validText(item.side, 20) || !validText(item.group, 40) || !validText(item.status, 40)) return "的分组信息不合法";
  if (!validNumber(item.count, 1, LIMITS.quantity, true)) return "的人数不合法";
  return "";
}

function validateRecord(item) {
  if (!isPlainObject(item)) return "格式不正确";
  if (!validId(item.id) || !validText(item.title, 120, true)) return "的 ID 或名称不合法";
  if (!validText(item.category, 40) || !validText(item.materialCategory, 40) || !validText(item.materialTitle, 100) || !validText(item.note, 500)) return "的文本内容不合法";
  if (!validId(item.materialId, false) || !validId(item.taskId, false)) return "的关联 ID 不合法";
  if (!validDate(item.date) || !validTimestamp(item.createdAt) || !validTimestamp(item.updatedAt)) return "的日期不合法";
  if (!validOptionalNumber(item.amount, 0, LIMITS.money) || !validOptionalNumber(item.unitPrice, 0, LIMITS.money) || !validOptionalNumber(item.quantity, 0, LIMITS.quantity)) return "的数量或金额不合法";
  if (!validBoolean(item.bought)) return "的购买状态不合法";
  if (item.photos !== undefined && (!Array.isArray(item.photos) || item.photos.length > LIMITS.photosPerRecord || item.photos.some(photo => !validText(photo, 512, true)))) return "的图片列表不合法";
  return "";
}

function validatePhotoDisplay(value) {
  if (!isPlainObject(value)) return "照片展示设置格式不正确";
  if (value.mode !== undefined && !["aspectFill", "aspectFit"].includes(value.mode)) return "照片展示模式不支持";
  for (const key of ["scale", "x", "y"]) {
    if (!validOptionalNumber(value[key], -10000, 10000)) return "照片展示参数不合法";
  }
  return "";
}

function validatePayload(payload, weddingId) {
  if (!isPlainObject(payload)) return "同步数据格式不正确";
  const allowedKeys = ["wedding", "tasks", "materials", "budgets", "guests", "records", "photo", "photoOriginal", "photoDisplay"];
  const unknownKeys = Object.keys(payload).filter(key => !allowedKeys.includes(key));
  if (unknownKeys.length) return `包含不支持的字段：${unknownKeys.join(", ")}`;
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > LIMITS.payloadBytes) return "同步数据超过大小限制";

  const checks = [
    validateWedding(payload.wedding),
    validateList(payload.tasks, "任务", LIMITS.tasks, validateTask),
    validateList(payload.materials, "婚品", LIMITS.materials, validateMaterial),
    validateList(payload.budgets, "预算", LIMITS.budgets, validateBudget),
    validateList(payload.guests, "宾客", LIMITS.guests, validateGuest),
    validateList(payload.records, "记录", LIMITS.records, validateRecord),
  ];
  const error = checks.find(Boolean);
  if (error) return error;
  const customMaterialImageCount = payload.materials.filter(item => (
    typeof item.customImage === "string" && item.customImage.startsWith("cloud://")
  )).length;
  if (customMaterialImageCount > LIMITS.customMaterialImages) {
    return `自定义婚品图片超过体验上限（${LIMITS.customMaterialImages} 张）`;
  }
  if (!validText(payload.photo, 512) || !validText(payload.photoOriginal, 512)) return "婚礼照片地址不合法";
  const displayError = validatePhotoDisplay(payload.photoDisplay);
  if (displayError) return displayError;
  const invalidFileId = [...collectCloudFileIds(payload)].find(fileId => !isOwnedCloudFileId(fileId, weddingId));
  if (invalidFileId) return "同步数据包含不属于当前婚礼的云文件";
  return "";
}

module.exports = { LIMITS, collectCloudFileIds, isOwnedCloudFileId, validatePayload };
