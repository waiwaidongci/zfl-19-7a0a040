const http = require("http");
const { readFile, writeFile, mkdir } = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 3019);
const DB_FILE = path.join(__dirname, "data", "db.json");

const initialData = {
  tunes: [
    {
      id: "tune_demo",
      title: "雨后圆舞曲",
      composer: "匿名",
      stripSpec: {
        widthMm: 70,
        scale: "20音",
        tempoBpm: 82,
        paperType: "半透明纸带"
      },
      templateId: null,
      templateNameSnapshot: null,
      currentEditionId: "edition_demo_init",
      archived: false,
      archivedAt: null,
      createdAt: new Date().toISOString()
    }
  ],
  tapeEditions: [
    {
      id: "edition_demo_init",
      tuneId: "tune_demo",
      version: 1,
      source: "initial",
      sourceEditionId: null,
      description: "初始版次",
      sectionsSnapshot: [
        {
          id: "section_demo_1",
          tuneId: "tune_demo",
          startBeat: 1,
          endBeat: 32,
          laneRange: "1-10",
          checked: true,
          note: "开头主题已试奏"
        },
        {
          id: "section_demo_2",
          tuneId: "tune_demo",
          startBeat: 33,
          endBeat: 64,
          laneRange: "4-18",
          checked: false,
          note: "副歌段等待校对"
        }
      ],
      isCurrent: true,
      createdAt: new Date().toISOString()
    }
  ],
  sections: [
    {
      id: "section_demo_1",
      tuneId: "tune_demo",
      startBeat: 1,
      endBeat: 32,
      laneRange: "1-10",
      checked: true,
      note: "开头主题已试奏"
    },
    {
      id: "section_demo_2",
      tuneId: "tune_demo",
      startBeat: 33,
      endBeat: 64,
      laneRange: "4-18",
      checked: false,
      note: "副歌段等待校对"
    }
  ],
  issues: [
    {
      id: "issue_demo",
      tuneId: "tune_demo",
      sectionId: "section_demo_2",
      type: "漏孔",
      beat: 41,
      lane: 12,
      description: "第41拍高音孔漏打",
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      fixDescription: null,
      fixTime: null,
      reviewNote: null
    }
  ],
  playSessions: [],
  punchTasks: [
    {
      id: "task_demo_1",
      tuneId: "tune_demo",
      sectionId: "section_demo_2",
      priority: "high",
      assignee: null,
      status: "pending",
      createdAt: new Date().toISOString(),
      claimedAt: null,
      completedAt: null,
      note: "副歌段待打孔校对"
    }
  ],
  stripSpecTemplates: [
    {
      id: "tpl_20_standard",
      name: "20音标准纸带",
      description: "常用20音手摇风琴标准规格，宽度70mm",
      stripSpec: {
        widthMm: 70,
        scale: "20音",
        tempoBpm: 80,
        paperType: "普通纸带"
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "tpl_20_semitrans",
      name: "20音半透明纸带",
      description: "半透明材质纸带，便于对齐试奏",
      stripSpec: {
        widthMm: 70,
        scale: "20音",
        tempoBpm: 82,
        paperType: "半透明纸带"
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "tpl_20_thick",
      name: "20音加厚纸带",
      description: "加厚耐用纸带，适合高频演出使用",
      stripSpec: {
        widthMm: 72,
        scale: "20音",
        tempoBpm: 76,
        paperType: "加厚纸带"
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "tpl_20_slow",
      name: "20音慢速练习纸带",
      description: "适合初学者慢速练习，推荐70BPM",
      stripSpec: {
        widthMm: 70,
        scale: "20音",
        tempoBpm: 70,
        paperType: "普通纸带"
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "tpl_20_performance",
      name: "20音演出纸带",
      description: "高速表演用，推荐88BPM",
      stripSpec: {
        widthMm: 70,
        scale: "20音",
        tempoBpm: 88,
        paperType: "半透明纸带"
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  reportSnapshots: []
};

const routes = [
  "GET /health",
  "GET /tunes",
  "POST /tunes",
  "GET /tunes/:id",
  "GET /tunes/:id/progress",
  "GET /tunes/:id/sections",
  "POST /tunes/:id/sections",
  "POST /tunes/:id/sections/batch",
  "GET /tunes/:id/unchecked-sections",
  "GET /tunes/:id/editions",
  "POST /tunes/:id/editions",
  "GET /tunes/:id/editions/:editionId",
  "PATCH /tunes/:id/editions/:editionId/current",
  "GET /tunes/:id/play-sessions",
  "POST /tunes/:id/play-sessions",
  "PATCH /tunes/:id/archive",
  "PATCH /tunes/:id/unarchive",
  "GET /tunes/:id/report",
  "POST /tunes/:id/report/snapshot",
  "GET /tunes/:id/report/snapshots",
  "GET /report-snapshots/:id",
  "PATCH /sections/:id/check",
  "GET /issues",
  "POST /issues",
  "PATCH /issues/:id/status",
  "GET /play-sessions/:id",
  "PATCH /play-sessions/:id/end",
  "GET /strip-spec-templates",
  "POST /strip-spec-templates",
  "GET /punch-tasks",
  "POST /punch-tasks/generate",
  "POST /punch-tasks",
  "PATCH /punch-tasks/:id/claim",
  "PATCH /punch-tasks/:id/complete"
];

async function ensureDb() {
  await mkdir(path.dirname(DB_FILE), { recursive: true });
  try {
    const data = JSON.parse(await readFile(DB_FILE, "utf8"));
    let needWrite = false;
    if (!data.stripSpecTemplates) {
      data.stripSpecTemplates = initialData.stripSpecTemplates;
      needWrite = true;
    }
    if (!data.playSessions) {
      data.playSessions = [];
      needWrite = true;
    }
    if (!data.punchTasks) {
      data.punchTasks = [];
      needWrite = true;
    }
    if (!data.tapeEditions) {
      data.tapeEditions = [];
      needWrite = true;
    }
    if (!data.reportSnapshots) {
      data.reportSnapshots = [];
      needWrite = true;
    }
    for (const tune of data.tunes || []) {
      if (tune.templateId === undefined) {
        tune.templateId = null;
        tune.templateNameSnapshot = null;
        needWrite = true;
      }
      if (tune.currentEditionId === undefined) {
        tune.currentEditionId = null;
        needWrite = true;
      }
      if (tune.archived === undefined) {
        tune.archived = false;
        tune.archivedAt = null;
        needWrite = true;
      }
    }
    for (const issue of data.issues || []) {
      if (issue.editionId === undefined) {
        issue.editionId = null;
        needWrite = true;
      }
      if (issue.fixDescription === undefined) {
        issue.fixDescription = null;
        needWrite = true;
      }
      if (issue.fixTime === undefined) {
        issue.fixTime = null;
        needWrite = true;
      }
      if (issue.reviewNote === undefined) {
        issue.reviewNote = null;
        needWrite = true;
      }
      if (issue.status === "resolved") {
        issue.status = "verified";
        needWrite = true;
      }
    }
    for (const tune of data.tunes || []) {
      if (!tune.currentEditionId) {
        const existingEdition = data.tapeEditions.find(
          (e) => e.tuneId === tune.id && e.isCurrent
        );
        if (!existingEdition) {
          const tuneSections = (data.sections || []).filter(
            (s) => s.tuneId === tune.id
          );
          const edition = {
            id: makeId("edition"),
            tuneId: tune.id,
            version: 1,
            source: "initial",
            sourceEditionId: null,
            description: "历史数据迁移初始版次",
            sectionsSnapshot: JSON.parse(JSON.stringify(tuneSections)),
            isCurrent: true,
            createdAt: tune.createdAt || new Date().toISOString()
          };
          data.tapeEditions.push(edition);
          tune.currentEditionId = edition.id;
          for (const issue of data.issues || []) {
            if (issue.tuneId === tune.id && !issue.editionId) {
              issue.editionId = edition.id;
            }
          }
          needWrite = true;
        }
      } else {
        for (const issue of data.issues || []) {
          if (issue.tuneId === tune.id && !issue.editionId) {
            issue.editionId = tune.currentEditionId;
            needWrite = true;
          }
        }
      }
    }
    if (needWrite) {
      await writeFile(DB_FILE, JSON.stringify(data, null, 2));
    }
  } catch {
    await writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await readFile(DB_FILE, "utf8"));
}

async function writeDb(data) {
  await writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function parseUrl(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return { pathname: url.pathname, searchParams: url.searchParams };
}

async function parseBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求体必须是合法JSON");
    error.status = 400;
    throw error;
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function required(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === "");
  if (missing.length) {
    const error = new Error(`缺少字段：${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

function findTune(db, tuneId) {
  const tune = db.tunes.find((item) => item.id === tuneId);
  if (!tune) {
    const error = new Error("曲目不存在");
    error.status = 404;
    throw error;
  }
  return tune;
}

function ensureTuneNotArchived(tune) {
  if (tune.archived) {
    const error = new Error("曲目已归档，无法执行该操作，请先恢复曲目");
    error.status = 403;
    throw error;
  }
}

function findTemplate(db, templateId) {
  const template = db.stripSpecTemplates.find((item) => item.id === templateId);
  if (!template) {
    const error = new Error("纸带规格模板不存在");
    error.status = 404;
    throw error;
  }
  return template;
}

function findSection(db, sectionId) {
  const section = db.sections.find((item) => item.id === sectionId);
  if (!section) {
    const error = new Error("区间不存在");
    error.status = 404;
    throw error;
  }
  return section;
}

function findPunchTask(db, taskId) {
  const task = db.punchTasks.find((item) => item.id === taskId);
  if (!task) {
    const error = new Error("打孔任务不存在");
    error.status = 404;
    throw error;
  }
  return task;
}

function findEdition(db, editionId) {
  const edition = db.tapeEditions.find((item) => item.id === editionId);
  if (!edition) {
    const error = new Error("纸带版次不存在");
    error.status = 404;
    throw error;
  }
  return edition;
}

function getTuneCurrentEdition(db, tuneId) {
  const tune = findTune(db, tuneId);
  if (!tune.currentEditionId) {
    const error = new Error("该曲目尚无当前版次");
    error.status = 400;
    throw error;
  }
  return findEdition(db, tune.currentEditionId);
}

function resolveEditionId(db, tuneId, editionId) {
  if (editionId) return editionId;
  const tune = findTune(db, tuneId);
  return tune.currentEditionId || null;
}

function resolveTuneEdition(db, tuneId, editionId) {
  const resolvedEditionId = resolveEditionId(db, tuneId, editionId);
  if (!resolvedEditionId) return null;
  const edition = findEdition(db, resolvedEditionId);
  if (edition.tuneId !== tuneId) {
    const error = new Error("版次不属于该曲目");
    error.status = 400;
    throw error;
  }
  return edition;
}

function validatePriority(priority) {
  const valid = ["low", "medium", "high", "urgent"];
  if (!valid.includes(priority)) {
    const error = new Error(`优先级必须是：${valid.join("、")}`);
    error.status = 400;
    throw error;
  }
}

function validateTaskStatus(status) {
  const valid = ["pending", "claimed", "completed"];
  if (!valid.includes(status)) {
    const error = new Error(`任务状态必须是：${valid.join("、")}`);
    error.status = 400;
    throw error;
  }
}

function validateIssueStatus(status) {
  const valid = ["open", "fixed", "verified", "reopened", "resolved"];
  if (!valid.includes(status)) {
    const error = new Error(`问题状态必须是：${valid.join("、")}`);
    error.status = 400;
    throw error;
  }
}

function normalizeIssueStatus(status) {
  return status === "resolved" ? "verified" : status;
}

function validateIssueStatusTransition(from, to) {
  const normalizedFrom = normalizeIssueStatus(from);
  const normalizedTo = normalizeIssueStatus(to);
  const validTransitions = {
    open: ["fixed"],
    fixed: ["verified", "reopened"],
    verified: ["reopened"],
    reopened: ["fixed"]
  };
  const allowed = validTransitions[normalizedFrom] || [];
  if (!allowed.includes(normalizedTo)) {
    const error = new Error(`不允许从 ${from} 状态转为 ${to} 状态`);
    error.status = 400;
    throw error;
  }
}

function validateStripSpec(spec) {
  if (!spec || typeof spec !== "object") {
    const error = new Error("stripSpec 必须是对象");
    error.status = 400;
    throw error;
  }
  const requiredFields = ["widthMm", "scale", "tempoBpm", "paperType"];
  const missing = requiredFields.filter((f) => spec[f] === undefined || spec[f] === "");
  if (missing.length) {
    const error = new Error(`stripSpec 缺少字段：${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

function validateLaneRange(laneRange) {
  if (typeof laneRange !== "string") return false;
  const match = laneRange.match(/^(\d+)-(\d+)$/);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return start > 0 && end >= start;
}

function checkOverlap(section1, section2) {
  return !(section1.endBeat < section2.startBeat || section2.endBeat < section1.startBeat);
}

function isSameSection(section1, section2) {
  return (
    section1.startBeat === section2.startBeat &&
    section1.endBeat === section2.endBeat &&
    section1.laneRange === section2.laneRange
  );
}

function buildProgress(db, tuneId) {
  findTune(db, tuneId);
  const edition = resolveTuneEdition(db, tuneId, null);
  const sections = edition
    ? edition.sectionsSnapshot
    : db.sections.filter((item) => item.tuneId === tuneId);
  const issues = db.issues.filter(
    (item) =>
      item.tuneId === tuneId &&
      (!edition || item.editionId === edition.id)
  );
  const sessions = db.playSessions.filter((item) => item.tuneId === tuneId);
  const checkedCount = sections.filter((item) => item.checked).length;
  const openIssues = issues.filter((item) => item.status !== "verified").length;
  const resolvedIssues = issues.filter((item) => item.status === "verified").length;
  let lastPlayedAt = null;
  if (sessions.length) {
    lastPlayedAt = sessions.reduce((latest, s) => {
      const t = s.endedAt || s.startedAt;
      return !latest || t > latest ? t : latest;
    }, null);
  }
  return {
    tuneId,
    totalSections: sections.length,
    checkedSections: checkedCount,
    uncheckedSections: sections.length - checkedCount,
    openIssues,
    resolvedIssues,
    percent: sections.length ? Math.round((checkedCount / sections.length) * 100) : 0,
    lastPlayedAt
  };
}

function buildReport(db, tuneId) {
  const tune = findTune(db, tuneId);
  const edition = resolveTuneEdition(db, tuneId, null);
  const sections = db.sections.filter((item) => item.tuneId === tuneId);
  const issues = db.issues.filter(
    (item) =>
      item.tuneId === tuneId &&
      (!edition || item.editionId === edition.id)
  );

  const checkedSections = sections.filter((s) => s.checked);
  const uncheckedSections = sections.filter((s) => !s.checked);
  const openIssues = issues.filter((i) => i.status !== "verified");
  const closedIssues = issues.filter((i) => i.status === "verified");

  const issueCountByType = {};
  for (const issue of issues) {
    issueCountByType[issue.type] = (issueCountByType[issue.type] || 0) + 1;
  }

  const uncheckedSectionDetails = uncheckedSections.map((s) => ({
    id: s.id,
    startBeat: s.startBeat,
    endBeat: s.endBeat,
    laneRange: s.laneRange,
    note: s.note
  }));

  const openIssueDetails = openIssues.map((i) => ({
    id: i.id,
    type: i.type,
    sectionId: i.sectionId,
    beat: i.beat,
    lane: i.lane,
    description: i.description,
    status: i.status,
    createdAt: i.createdAt
  }));

  const nextSteps = [];
  const pendingPunchTasks = db.punchTasks.filter(
    (t) => t.tuneId === tuneId && t.status !== "completed"
  );
  const uncheckedWithUrgentTask = uncheckedSections.filter((s) =>
    pendingPunchTasks.some(
      (t) => t.sectionId === s.id && (t.priority === "urgent" || t.priority === "high")
    )
  );
  for (const s of uncheckedWithUrgentTask) {
    const task = pendingPunchTasks.find((t) => t.sectionId === s.id);
    nextSteps.push({
      action: "punch_task",
      priority: task.priority,
      sectionId: s.id,
      section: { startBeat: s.startBeat, endBeat: s.endBeat, laneRange: s.laneRange },
      taskId: task.id,
      note: "该区间有高优先级打孔任务"
    });
  }
  const remainingUnchecked = uncheckedSections.filter(
    (s) => !uncheckedWithUrgentTask.some((u) => u.id === s.id)
  );
  for (const s of remainingUnchecked) {
    nextSteps.push({
      action: "check_section",
      priority: "medium",
      sectionId: s.id,
      section: { startBeat: s.startBeat, endBeat: s.endBeat, laneRange: s.laneRange },
      note: "区间尚未检查"
    });
  }
  const openIssuesBySection = {};
  for (const issue of openIssues) {
    if (!openIssuesBySection[issue.sectionId]) {
      openIssuesBySection[issue.sectionId] = [];
    }
    openIssuesBySection[issue.sectionId].push(issue);
  }
  const sectionsWithOpenIssues = Object.keys(openIssuesBySection).filter(
    (sid) => !uncheckedWithUrgentTask.some((u) => u.id === sid) &&
      !remainingUnchecked.some((u) => u.id === sid)
  );
  for (const sid of sectionsWithOpenIssues) {
    const section = sections.find((s) => s.id === sid);
    const sectionIssues = openIssuesBySection[sid];
    nextSteps.push({
      action: "fix_issues",
      priority: "high",
      sectionId: sid,
      section: section
        ? { startBeat: section.startBeat, endBeat: section.endBeat, laneRange: section.laneRange }
        : null,
      issueCount: sectionIssues.length,
      issueTypes: [...new Set(sectionIssues.map((i) => i.type))],
      note: `该区间有 ${sectionIssues.length} 个未关闭问题`
    });
  }
  nextSteps.sort((a, b) => {
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  return {
    tuneId: tune.id,
    tuneTitle: tune.title,
    composer: tune.composer,
    stripSpec: tune.stripSpec,
    editionId: edition ? edition.id : null,
    editionVersion: edition ? edition.version : null,
    coverage: {
      totalSections: sections.length,
      checkedSections: checkedSections.length,
      uncheckedSections: uncheckedSections.length,
      coveragePercent: sections.length
        ? Math.round((checkedSections.length / sections.length) * 100)
        : 0
    },
    uncheckedSectionDetails,
    openIssueDetails,
    issueCountByType,
    summary: {
      totalIssues: issues.length,
      openIssues: openIssues.length,
      closedIssues: closedIssues.length
    },
    suggestedNextSteps: nextSteps,
    generatedAt: new Date().toISOString()
  };
}

async function handle(req, res) {
  const { pathname, searchParams } = parseUrl(req);
  const db = await readDb();

  if (req.method === "GET" && pathname === "/health") {
    return send(res, 200, { ok: true, service: "organ-strip-punch-api", routes });
  }

  if (req.method === "GET" && pathname === "/tunes") {
    const archivedFilter = searchParams.get("archived");
    let tunes = db.tunes;
    if (archivedFilter === "true") {
      tunes = tunes.filter((t) => t.archived);
    } else if (archivedFilter === "false" || archivedFilter === null) {
      tunes = tunes.filter((t) => !t.archived);
    }
    const result = tunes.map((tune) => ({ ...tune, progress: buildProgress(db, tune.id) }));
    return send(res, 200, { data: result });
  }

  if (req.method === "POST" && pathname === "/tunes") {
    const body = await parseBody(req);
    required(body, ["title"]);

    let stripSpec = body.stripSpec;
    let templateId = null;
    let templateNameSnapshot = null;

    if (body.templateId) {
      const template = findTemplate(db, body.templateId);
      stripSpec = JSON.parse(JSON.stringify(template.stripSpec));
      templateId = template.id;
      templateNameSnapshot = template.name;

      if (body.stripSpec) {
        stripSpec = { ...stripSpec, ...body.stripSpec };
      }
    }

    if (!stripSpec) {
      const error = new Error("必须提供 stripSpec 或 templateId");
      error.status = 400;
      throw error;
    }

    validateStripSpec(stripSpec);

    const tune = {
      id: makeId("tune"),
      title: body.title,
      composer: body.composer || "",
      stripSpec,
      templateId,
      templateNameSnapshot,
      currentEditionId: null,
      archived: false,
      archivedAt: null,
      createdAt: new Date().toISOString()
    };
    const edition = {
      id: makeId("edition"),
      tuneId: tune.id,
      version: 1,
      source: "initial",
      sourceEditionId: null,
      description: body.editionDescription || "初始版次",
      sectionsSnapshot: [],
      isCurrent: true,
      createdAt: new Date().toISOString()
    };
    tune.currentEditionId = edition.id;
    db.tunes.push(tune);
    db.tapeEditions.push(edition);
    await writeDb(db);
    return send(res, 201, { data: tune, edition });
  }

  const tuneDetailMatch = pathname.match(/^\/tunes\/([^/]+)$/);
  if (tuneDetailMatch && req.method === "GET") {
    const tuneId = tuneDetailMatch[1];
    const tune = findTune(db, tuneId);
    const progress = buildProgress(db, tuneId);
    return send(res, 200, { data: { ...tune, progress } });
  }

  const tuneSectionsMatch = pathname.match(/^\/tunes\/([^/]+)\/sections$/);
  if (tuneSectionsMatch && req.method === "GET") {
    const tuneId = tuneSectionsMatch[1];
    const editionId = searchParams.get("editionId");
    const edition = resolveTuneEdition(db, tuneId, editionId);
    if (edition) {
      return send(res, 200, { data: edition.sectionsSnapshot });
    }
    return send(res, 200, { data: db.sections.filter((item) => item.tuneId === tuneId) });
  }

  if (tuneSectionsMatch && req.method === "POST") {
    const tuneId = tuneSectionsMatch[1];
    const tune = findTune(db, tuneId);
    ensureTuneNotArchived(tune);
    const body = await parseBody(req);
    required(body, ["startBeat", "endBeat", "laneRange"]);
    const section = {
      id: makeId("section"),
      tuneId,
      startBeat: Number(body.startBeat),
      endBeat: Number(body.endBeat),
      laneRange: body.laneRange,
      checked: Boolean(body.checked),
      note: body.note || ""
    };
    db.sections.push(section);

    if (tune.currentEditionId) {
      const edition = db.tapeEditions.find((e) => e.id === tune.currentEditionId);
      if (edition) {
        edition.sectionsSnapshot.push({ ...section });
      }
    }

    await writeDb(db);
    return send(res, 201, { data: section });
  }

  const batchSectionsMatch = pathname.match(/^\/tunes\/([^/]+)\/sections\/batch$/);
  if (batchSectionsMatch && req.method === "POST") {
    const tuneId = batchSectionsMatch[1];
    const tune = findTune(db, tuneId);
    ensureTuneNotArchived(tune);
    const body = await parseBody(req);

    if (!Array.isArray(body)) {
      return send(res, 400, { error: "请求体必须是区间数组" });
    }

    if (body.length === 0) {
      return send(res, 400, { error: "区间数组不能为空" });
    }

    const errors = [];
    const existingSections = db.sections.filter((s) => s.tuneId === tuneId);
    const validSections = [];
    const skippedDuplicates = [];

    for (let i = 0; i < body.length; i++) {
      const item = body[i];
      const rowErrors = [];

      if (item.startBeat === undefined || item.startBeat === "") {
        rowErrors.push("缺少字段：startBeat");
      } else if (isNaN(Number(item.startBeat))) {
        rowErrors.push("startBeat 必须是数字");
      }

      if (item.endBeat === undefined || item.endBeat === "") {
        rowErrors.push("缺少字段：endBeat");
      } else if (isNaN(Number(item.endBeat))) {
        rowErrors.push("endBeat 必须是数字");
      }

      if (item.laneRange === undefined || item.laneRange === "") {
        rowErrors.push("缺少字段：laneRange");
      } else if (!validateLaneRange(item.laneRange)) {
        rowErrors.push("laneRange 格式无效，应为类似 \"1-10\" 的格式");
      }

      const hasValidBeats = !isNaN(Number(item.startBeat)) && !isNaN(Number(item.endBeat)) &&
        item.startBeat !== undefined && item.startBeat !== "" &&
        item.endBeat !== undefined && item.endBeat !== "";

      if (hasValidBeats) {
        const startBeat = Number(item.startBeat);
        const endBeat = Number(item.endBeat);

        if (endBeat < startBeat) {
          rowErrors.push("endBeat 不能小于 startBeat");
        }
      }

      if (rowErrors.length === 0) {
        const startBeat = Number(item.startBeat);
        const endBeat = Number(item.endBeat);
        const tempSection = { startBeat, endBeat, laneRange: item.laneRange };

        const isDuplicate = existingSections.some((s) => isSameSection(s, tempSection)) ||
          validSections.some((s) => isSameSection(s, tempSection));

        if (isDuplicate) {
          skippedDuplicates.push({
            index: i,
            startBeat,
            endBeat,
            laneRange: item.laneRange
          });
          continue;
        }

        const overlapWithExisting = existingSections.some((s) => checkOverlap(s, tempSection));
        const overlapWithBatch = validSections.some((s) => checkOverlap(s, tempSection));

        if (overlapWithExisting || overlapWithBatch) {
          rowErrors.push("区间与现有区间或批量导入中的其他区间重叠");
        }

        if (rowErrors.length === 0) {
          validSections.push({
            ...tempSection,
            checked: Boolean(item.checked),
            note: item.note || ""
          });
        }
      }

      if (rowErrors.length > 0) {
        errors.push({
          index: i,
          data: item,
          errors: rowErrors
        });
      }
    }

    if (errors.length > 0) {
      return send(res, 400, {
        error: "批量导入验证失败",
        errors
      });
    }

    const createdSections = [];
    for (const vs of validSections) {
      const section = {
        id: makeId("section"),
        tuneId,
        startBeat: vs.startBeat,
        endBeat: vs.endBeat,
        laneRange: vs.laneRange,
        checked: vs.checked,
        note: vs.note
      };
      db.sections.push(section);
      createdSections.push(section);
    }

    if (tune.currentEditionId) {
      const edition = db.tapeEditions.find((e) => e.id === tune.currentEditionId);
      if (edition) {
        for (const section of createdSections) {
          edition.sectionsSnapshot.push({ ...section });
        }
      }
    }

    await writeDb(db);

    const progress = buildProgress(db, tuneId);

    return send(res, 201, {
      addedCount: createdSections.length,
      skippedDuplicates,
      progress,
      data: createdSections
    });
  }

  const uncheckedMatch = pathname.match(/^\/tunes\/([^/]+)\/unchecked-sections$/);
  if (uncheckedMatch && req.method === "GET") {
    const tuneId = uncheckedMatch[1];
    const editionId = searchParams.get("editionId");
    const edition = resolveTuneEdition(db, tuneId, editionId);
    if (edition) {
      return send(res, 200, { data: edition.sectionsSnapshot.filter((s) => !s.checked) });
    }
    return send(res, 200, { data: db.sections.filter((item) => item.tuneId === tuneId && !item.checked) });
  }

  const progressMatch = pathname.match(/^\/tunes\/([^/]+)\/progress$/);
  if (progressMatch && req.method === "GET") {
    return send(res, 200, { data: buildProgress(db, progressMatch[1]) });
  }

  const checkMatch = pathname.match(/^\/sections\/([^/]+)\/check$/);
  if (checkMatch && req.method === "PATCH") {
    const section = db.sections.find((item) => item.id === checkMatch[1]);
    if (!section) return send(res, 404, { error: "区间不存在" });
    const tune = findTune(db, section.tuneId);
    ensureTuneNotArchived(tune);
    const body = await parseBody(req);
    section.checked = body.checked !== undefined ? Boolean(body.checked) : true;
    section.note = body.note ?? section.note;

    if (tune.currentEditionId) {
      const edition = db.tapeEditions.find((e) => e.id === tune.currentEditionId);
      if (edition) {
        const snapSection = edition.sectionsSnapshot.find((s) => s.id === section.id);
        if (snapSection) {
          snapSection.checked = section.checked;
          snapSection.note = section.note;
        }
      }
    }

    await writeDb(db);
    return send(res, 200, { data: section });
  }

  if (req.method === "GET" && pathname === "/issues") {
    const tuneId = searchParams.get("tuneId");
    const status = searchParams.get("status");
    const editionId = searchParams.get("editionId");
    const edition = tuneId ? resolveTuneEdition(db, tuneId, editionId) : null;
    const filterStatus = status ? normalizeIssueStatus(status) : null;
    const issues = db.issues.filter((item) => {
      if (tuneId && item.tuneId !== tuneId) return false;
      if (filterStatus && item.status !== filterStatus) return false;
      if (editionId && item.editionId !== editionId) return false;
      if (!editionId && edition && item.editionId !== edition.id) return false;
      return true;
    });
    return send(res, 200, { data: issues });
  }

  if (req.method === "POST" && pathname === "/issues") {
    const body = await parseBody(req);
    required(body, ["tuneId", "sectionId", "type", "description"]);
    const tune = findTune(db, body.tuneId);
    ensureTuneNotArchived(tune);
    const section = db.sections.find((item) => item.id === body.sectionId && item.tuneId === body.tuneId);
    if (!section) return send(res, 400, { error: "区间不存在或不属于该曲目" });
    const resolvedEditionId = resolveEditionId(db, body.tuneId, body.editionId || null);
    if (resolvedEditionId) {
      const edition = findEdition(db, resolvedEditionId);
      if (edition.tuneId !== body.tuneId) {
        return send(res, 400, { error: "版次不属于该曲目" });
      }
      const sectionInEdition = edition.sectionsSnapshot.find(
        (s) => s.id === body.sectionId
      );
      if (!sectionInEdition) {
        return send(res, 400, { error: "区间不存在于指定版次中" });
      }
    }
    const issue = {
      id: makeId("issue"),
      tuneId: body.tuneId,
      editionId: resolvedEditionId,
      sectionId: body.sectionId,
      type: body.type,
      beat: body.beat === undefined ? null : Number(body.beat),
      lane: body.lane === undefined ? null : Number(body.lane),
      description: body.description,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      fixDescription: null,
      fixTime: null,
      reviewNote: null
    };
    db.issues.push(issue);
    await writeDb(db);
    return send(res, 201, { data: issue });
  }

  const issueStatusMatch = pathname.match(/^\/issues\/([^/]+)\/status$/);
  if (issueStatusMatch && req.method === "PATCH") {
    const issue = db.issues.find((item) => item.id === issueStatusMatch[1]);
    if (!issue) return send(res, 404, { error: "问题不存在" });
    const tune = findTune(db, issue.tuneId);
    ensureTuneNotArchived(tune);
    const body = await parseBody(req);
    required(body, ["status"]);
    validateIssueStatus(body.status);
    validateIssueStatusTransition(issue.status, body.status);

    const newStatus = normalizeIssueStatus(body.status);
    const now = new Date().toISOString();

    issue.status = newStatus;

    if (newStatus === "fixed") {
      required(body, ["fixDescription"]);
      issue.fixDescription = body.fixDescription;
      issue.fixTime = now;
    }

    if (newStatus === "verified") {
      issue.resolvedAt = now;
      issue.reviewNote = body.reviewNote ?? issue.reviewNote;
    }

    if (newStatus === "reopened") {
      required(body, ["reviewNote"]);
      issue.reviewNote = body.reviewNote;
      issue.resolvedAt = null;
    }

    issue.note = body.note ?? issue.note;

    await writeDb(db);
    return send(res, 200, { data: issue });
  }

  const playSessionsListMatch = pathname.match(/^\/tunes\/([^/]+)\/play-sessions$/);
  if (playSessionsListMatch && req.method === "GET") {
    const tuneId = playSessionsListMatch[1];
    findTune(db, tuneId);
    const sessions = db.playSessions
      .filter((item) => item.tuneId === tuneId)
      .sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));
    return send(res, 200, { data: sessions });
  }

  if (playSessionsListMatch && req.method === "POST") {
    const tuneId = playSessionsListMatch[1];
    const tune = findTune(db, tuneId);
    ensureTuneNotArchived(tune);
    const body = await parseBody(req);
    required(body, ["player", "startSectionId"]);
    const session = {
      id: makeId("ps"),
      tuneId,
      player: body.player,
      startSectionId: body.startSectionId,
      endSectionId: null,
      issuesFound: 0,
      note: body.note || "",
      status: "active",
      startedAt: new Date().toISOString(),
      endedAt: null
    };
    db.playSessions.push(session);
    await writeDb(db);
    return send(res, 201, { data: session });
  }

  const archiveMatch = pathname.match(/^\/tunes\/([^/]+)\/archive$/);
  if (archiveMatch && req.method === "PATCH") {
    const tuneId = archiveMatch[1];
    const tune = findTune(db, tuneId);
    if (tune.archived) {
      return send(res, 400, { error: "曲目已处于归档状态" });
    }
    tune.archived = true;
    tune.archivedAt = new Date().toISOString();
    await writeDb(db);
    return send(res, 200, { data: tune });
  }

  const unarchiveMatch = pathname.match(/^\/tunes\/([^/]+)\/unarchive$/);
  if (unarchiveMatch && req.method === "PATCH") {
    const tuneId = unarchiveMatch[1];
    const tune = findTune(db, tuneId);
    if (!tune.archived) {
      return send(res, 400, { error: "曲目未处于归档状态" });
    }
    tune.archived = false;
    tune.archivedAt = null;
    await writeDb(db);
    return send(res, 200, { data: tune });
  }

  const playSessionMatch = pathname.match(/^\/play-sessions\/([^/]+)$/);
  if (playSessionMatch && req.method === "GET") {
    const sessionId = playSessionMatch[1];
    const session = db.playSessions.find((item) => item.id === sessionId);
    if (!session) return send(res, 404, { error: "试奏会话不存在" });
    return send(res, 200, { data: session });
  }

  const endSessionMatch = pathname.match(/^\/play-sessions\/([^/]+)\/end$/);
  if (endSessionMatch && req.method === "PATCH") {
    const sessionId = endSessionMatch[1];
    const session = db.playSessions.find((item) => item.id === sessionId);
    if (!session) return send(res, 404, { error: "试奏会话不存在" });
    const tune = findTune(db, session.tuneId);
    ensureTuneNotArchived(tune);
    if (session.status === "ended") {
      return send(res, 400, { error: "试奏会话已结束" });
    }
    const body = await parseBody(req);
    required(body, ["endSectionId"]);
    session.endSectionId = body.endSectionId ?? session.endSectionId;
    session.issuesFound = body.issuesFound !== undefined ? Number(body.issuesFound) : session.issuesFound;
    session.note = body.note !== undefined ? body.note : session.note;
    session.status = "ended";
    session.endedAt = new Date().toISOString();
    await writeDb(db);
    return send(res, 200, { data: session });
  }

  const tuneEditionsMatch = pathname.match(/^\/tunes\/([^/]+)\/editions$/);
  if (tuneEditionsMatch && req.method === "GET") {
    const tuneId = tuneEditionsMatch[1];
    findTune(db, tuneId);
    const editions = db.tapeEditions
      .filter((item) => item.tuneId === tuneId)
      .sort((a, b) => a.version - b.version);
    return send(res, 200, { data: editions });
  }

  if (tuneEditionsMatch && req.method === "POST") {
    const tuneId = tuneEditionsMatch[1];
    const tune = findTune(db, tuneId);
    ensureTuneNotArchived(tune);
    const body = await parseBody(req);
    required(body, ["description"]);

    let sectionsSnapshot;
    let source;
    let sourceEditionId = null;

    if (body.sourceEditionId) {
      const srcEdition = findEdition(db, body.sourceEditionId);
      if (srcEdition.tuneId !== tuneId) {
        return send(res, 400, { error: "来源版次不属于该曲目" });
      }
      sectionsSnapshot = JSON.parse(JSON.stringify(srcEdition.sectionsSnapshot));
      source = "copy_edition";
      sourceEditionId = srcEdition.id;
    } else {
      const currentSections = db.sections.filter((s) => s.tuneId === tuneId);
      sectionsSnapshot = JSON.parse(JSON.stringify(currentSections));
      source = tune.currentEditionId ? "copy_current" : "initial";
    }

    const tuneEditions = db.tapeEditions.filter((e) => e.tuneId === tuneId);
    const maxVersion = tuneEditions.reduce(
      (max, e) => Math.max(max, e.version),
      0
    );

    const setAsCurrent = body.setAsCurrent !== false;
    const edition = {
      id: makeId("edition"),
      tuneId,
      version: maxVersion + 1,
      source,
      sourceEditionId,
      description: body.description,
      sectionsSnapshot,
      isCurrent: setAsCurrent,
      createdAt: new Date().toISOString()
    };

    if (setAsCurrent) {
      for (const e of db.tapeEditions) {
        if (e.tuneId === tuneId) {
          e.isCurrent = false;
        }
      }
      tune.currentEditionId = edition.id;
      db.sections = db.sections.filter((s) => s.tuneId !== tuneId);
      for (const snap of edition.sectionsSnapshot) {
        const section = { ...snap, tuneId };
        db.sections.push(section);
      }
    }

    db.tapeEditions.push(edition);
    await writeDb(db);
    return send(res, 201, { data: edition });
  }

  const editionDetailMatch = pathname.match(
    /^\/tunes\/([^/]+)\/editions\/([^/]+)$/
  );
  if (editionDetailMatch && req.method === "GET") {
    const tuneId = editionDetailMatch[1];
    const editionId = editionDetailMatch[2];
    findTune(db, tuneId);
    const edition = findEdition(db, editionId);
    if (edition.tuneId !== tuneId) {
      return send(res, 400, { error: "版次不属于该曲目" });
    }
    return send(res, 200, { data: edition });
  }

  const editionCurrentMatch = pathname.match(
    /^\/tunes\/([^/]+)\/editions\/([^/]+)\/current$/
  );
  if (editionCurrentMatch && req.method === "PATCH") {
    const tuneId = editionCurrentMatch[1];
    const editionId = editionCurrentMatch[2];
    const tune = findTune(db, tuneId);
    ensureTuneNotArchived(tune);
    const edition = findEdition(db, editionId);
    if (edition.tuneId !== tuneId) {
      return send(res, 400, { error: "版次不属于该曲目" });
    }

    for (const e of db.tapeEditions) {
      if (e.tuneId === tuneId) {
        e.isCurrent = e.id === editionId;
      }
    }
    tune.currentEditionId = editionId;

    db.sections = db.sections.filter((s) => s.tuneId !== tuneId);
    for (const snap of edition.sectionsSnapshot) {
      const section = { ...snap, tuneId };
      db.sections.push(section);
    }

    await writeDb(db);
    return send(res, 200, { data: edition });
  }

  if (req.method === "GET" && pathname === "/strip-spec-templates") {
    const scale = searchParams.get("scale");
    const templates = db.stripSpecTemplates.filter(
      (item) => !scale || item.stripSpec.scale === scale
    );
    return send(res, 200, { data: templates });
  }

  if (req.method === "POST" && pathname === "/strip-spec-templates") {
    const body = await parseBody(req);
    required(body, ["name", "stripSpec"]);
    validateStripSpec(body.stripSpec);
    const template = {
      id: makeId("tpl"),
      name: body.name,
      description: body.description || "",
      stripSpec: JSON.parse(JSON.stringify(body.stripSpec)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.stripSpecTemplates.push(template);
    await writeDb(db);
    return send(res, 201, { data: template });
  }

  if (req.method === "GET" && pathname === "/punch-tasks") {
    const tuneId = searchParams.get("tuneId");
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const assignee = searchParams.get("assignee");
    const onlyUnassigned = searchParams.get("onlyUnassigned") === "true";

    if (status) validateTaskStatus(status);
    if (priority) validatePriority(priority);

    let tasks = db.punchTasks.filter((item) => {
      if (tuneId && item.tuneId !== tuneId) return false;
      if (status && item.status !== status) return false;
      if (priority && item.priority !== priority) return false;
      if (assignee && item.assignee !== assignee) return false;
      if (onlyUnassigned && item.assignee) return false;
      return true;
    });

    tasks = tasks.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.createdAt < b.createdAt ? -1 : 1;
    });

    const enriched = tasks.map((task) => {
      const tune = db.tunes.find((t) => t.id === task.tuneId);
      const section = db.sections.find((s) => s.id === task.sectionId);
      return {
        ...task,
        tuneTitle: tune ? tune.title : null,
        section: section
          ? {
              startBeat: section.startBeat,
              endBeat: section.endBeat,
              laneRange: section.laneRange,
              checked: section.checked,
              note: section.note
            }
          : null
      };
    });

    return send(res, 200, { data: enriched });
  }

  if (req.method === "POST" && pathname === "/punch-tasks/generate") {
    const body = await parseBody(req);
    const tuneId = body.tuneId;
    const defaultPriority = body.defaultPriority || "medium";
    validatePriority(defaultPriority);

    if (tuneId) {
      const tune = findTune(db, tuneId);
      ensureTuneNotArchived(tune);
    }

    const uncheckedSections = db.sections.filter((s) => {
      if (tuneId && s.tuneId !== tuneId) return false;
      if (s.checked) return false;
      const tune = db.tunes.find((t) => t.id === s.tuneId);
      if (tune && tune.archived) return false;
      return true;
    });

    if (uncheckedSections.length === 0) {
      return send(res, 200, { data: [], message: "没有未检查的区间需要生成任务" });
    }

    const createdTasks = [];
    for (const section of uncheckedSections) {
      const existingTask = db.punchTasks.find(
        (t) => t.sectionId === section.id && t.status !== "completed"
      );
      if (existingTask) continue;

      const task = {
        id: makeId("task"),
        tuneId: section.tuneId,
        sectionId: section.id,
        priority: defaultPriority,
        assignee: null,
        status: "pending",
        createdAt: new Date().toISOString(),
        claimedAt: null,
        completedAt: null,
        note: section.note || `区间 ${section.startBeat}-${section.endBeat} 待打孔`
      };
      db.punchTasks.push(task);
      createdTasks.push(task);
    }

    await writeDb(db);
    return send(res, 201, {
      data: createdTasks,
      totalCreated: createdTasks.length,
      totalSkipped: uncheckedSections.length - createdTasks.length
    });
  }

  if (req.method === "POST" && pathname === "/punch-tasks") {
    const body = await parseBody(req);
    required(body, ["tuneId", "sectionId"]);
    const tune = findTune(db, body.tuneId);
    ensureTuneNotArchived(tune);
    const section = findSection(db, body.sectionId);
    if (section.tuneId !== body.tuneId) {
      return send(res, 400, { error: "区间不属于该曲目" });
    }

    const priority = body.priority || "medium";
    validatePriority(priority);

    const existingTask = db.punchTasks.find(
      (t) => t.sectionId === body.sectionId && t.status !== "completed"
    );
    if (existingTask) {
      return send(res, 409, { error: "该区间已有进行中的打孔任务", data: existingTask });
    }

    const task = {
      id: makeId("task"),
      tuneId: body.tuneId,
      sectionId: body.sectionId,
      priority,
      assignee: null,
      status: "pending",
      createdAt: new Date().toISOString(),
      claimedAt: null,
      completedAt: null,
      note: body.note || ""
    };
    db.punchTasks.push(task);
    await writeDb(db);
    return send(res, 201, { data: task });
  }

  const claimTaskMatch = pathname.match(/^\/punch-tasks\/([^/]+)\/claim$/);
  if (claimTaskMatch && req.method === "PATCH") {
    const task = findPunchTask(db, claimTaskMatch[1]);
    const tune = findTune(db, task.tuneId);
    ensureTuneNotArchived(tune);
    if (task.status !== "pending") {
      return send(res, 400, { error: `当前任务状态为 ${task.status}，无法领取` });
    }
    const body = await parseBody(req);
    required(body, ["assignee"]);

    task.assignee = body.assignee;
    task.status = "claimed";
    task.claimedAt = new Date().toISOString();
    task.note = body.note ?? task.note;
    await writeDb(db);
    return send(res, 200, { data: task });
  }

  const completeTaskMatch = pathname.match(/^\/punch-tasks\/([^/]+)\/complete$/);
  if (completeTaskMatch && req.method === "PATCH") {
    const task = findPunchTask(db, completeTaskMatch[1]);
    const tune = findTune(db, task.tuneId);
    ensureTuneNotArchived(tune);
    if (task.status === "completed") {
      return send(res, 400, { error: "任务已完成" });
    }
    if (task.status === "pending") {
      return send(res, 400, { error: "任务尚未领取，请先领取任务" });
    }
    const body = await parseBody(req);

    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.note = body.note ?? task.note;

    if (body.checkSection === true) {
      const section = db.sections.find((s) => s.id === task.sectionId);
      if (section) {
        section.checked = true;
        if (body.sectionNote !== undefined) {
          section.note = body.sectionNote;
        }
        if (tune.currentEditionId) {
          const edition = db.tapeEditions.find((e) => e.id === tune.currentEditionId);
          if (edition) {
            const snapSection = edition.sectionsSnapshot.find((s) => s.id === section.id);
            if (snapSection) {
              snapSection.checked = section.checked;
              snapSection.note = section.note;
            }
          }
        }
      }
    }

    await writeDb(db);
    return send(res, 200, {
      data: task,
      sectionChecked: body.checkSection === true
    });
  }

  const reportMatch = pathname.match(/^\/tunes\/([^/]+)\/report$/);
  if (reportMatch && req.method === "GET") {
    const tuneId = reportMatch[1];
    const report = buildReport(db, tuneId);
    return send(res, 200, { data: report });
  }

  const reportSnapshotMatch = pathname.match(/^\/tunes\/([^/]+)\/report\/snapshot$/);
  if (reportSnapshotMatch && req.method === "POST") {
    const tuneId = reportSnapshotMatch[1];
    findTune(db, tuneId);
    const report = buildReport(db, tuneId);
    const body = await parseBody(req);
    const snapshot = {
      id: makeId("report"),
      tuneId,
      label: body.label || "",
      report,
      createdAt: new Date().toISOString()
    };
    db.reportSnapshots.push(snapshot);
    await writeDb(db);
    return send(res, 201, { data: snapshot });
  }

  const reportSnapshotsListMatch = pathname.match(/^\/tunes\/([^/]+)\/report\/snapshots$/);
  if (reportSnapshotsListMatch && req.method === "GET") {
    const tuneId = reportSnapshotsListMatch[1];
    findTune(db, tuneId);
    const snapshots = db.reportSnapshots
      .filter((s) => s.tuneId === tuneId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({
        id: s.id,
        tuneId: s.tuneId,
        label: s.label,
        createdAt: s.createdAt
      }));
    return send(res, 200, { data: snapshots });
  }

  const snapshotDetailMatch = pathname.match(/^\/report-snapshots\/([^/]+)$/);
  if (snapshotDetailMatch && req.method === "GET") {
    const snapshotId = snapshotDetailMatch[1];
    const snapshot = db.reportSnapshots.find((s) => s.id === snapshotId);
    if (!snapshot) return send(res, 404, { error: "报告快照不存在" });
    return send(res, 200, { data: snapshot });
  }

  return send(res, 404, { error: "接口不存在", routes });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => send(res, error.status || 500, { error: error.message || "服务器错误" }));
});

server.listen(PORT, () => {
  console.log(`Organ strip punch API running at http://127.0.0.1:${PORT}`);
});
