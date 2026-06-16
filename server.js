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
      resolvedAt: null
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
  ]
};

const routes = [
  "GET /health",
  "GET /tunes",
  "POST /tunes",
  "GET /tunes/:id/progress",
  "GET /tunes/:id/sections",
  "POST /tunes/:id/sections",
  "GET /tunes/:id/unchecked-sections",
  "GET /tunes/:id/play-sessions",
  "POST /tunes/:id/play-sessions",
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
    for (const tune of data.tunes || []) {
      if (tune.templateId === undefined) {
        tune.templateId = null;
        tune.templateNameSnapshot = null;
        needWrite = true;
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

function buildProgress(db, tuneId) {
  findTune(db, tuneId);
  const sections = db.sections.filter((item) => item.tuneId === tuneId);
  const issues = db.issues.filter((item) => item.tuneId === tuneId);
  const sessions = db.playSessions.filter((item) => item.tuneId === tuneId);
  const checkedCount = sections.filter((item) => item.checked).length;
  const openIssues = issues.filter((item) => item.status !== "resolved").length;
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
    resolvedIssues: issues.length - openIssues,
    percent: sections.length ? Math.round((checkedCount / sections.length) * 100) : 0,
    lastPlayedAt
  };
}

async function handle(req, res) {
  const { pathname, searchParams } = parseUrl(req);
  const db = await readDb();

  if (req.method === "GET" && pathname === "/health") {
    return send(res, 200, { ok: true, service: "organ-strip-punch-api", routes });
  }

  if (req.method === "GET" && pathname === "/tunes") {
    const tunes = db.tunes.map((tune) => ({ ...tune, progress: buildProgress(db, tune.id) }));
    return send(res, 200, { data: tunes });
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
      createdAt: new Date().toISOString()
    };
    db.tunes.push(tune);
    await writeDb(db);
    return send(res, 201, { data: tune });
  }

  const tuneSectionsMatch = pathname.match(/^\/tunes\/([^/]+)\/sections$/);
  if (tuneSectionsMatch && req.method === "GET") {
    const tuneId = tuneSectionsMatch[1];
    findTune(db, tuneId);
    return send(res, 200, { data: db.sections.filter((item) => item.tuneId === tuneId) });
  }

  if (tuneSectionsMatch && req.method === "POST") {
    const tuneId = tuneSectionsMatch[1];
    findTune(db, tuneId);
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
    await writeDb(db);
    return send(res, 201, { data: section });
  }

  const uncheckedMatch = pathname.match(/^\/tunes\/([^/]+)\/unchecked-sections$/);
  if (uncheckedMatch && req.method === "GET") {
    const tuneId = uncheckedMatch[1];
    findTune(db, tuneId);
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
    const body = await parseBody(req);
    section.checked = body.checked !== undefined ? Boolean(body.checked) : true;
    section.note = body.note ?? section.note;
    await writeDb(db);
    return send(res, 200, { data: section });
  }

  if (req.method === "GET" && pathname === "/issues") {
    const tuneId = searchParams.get("tuneId");
    const status = searchParams.get("status");
    const issues = db.issues.filter((item) => (!tuneId || item.tuneId === tuneId) && (!status || item.status === status));
    return send(res, 200, { data: issues });
  }

  if (req.method === "POST" && pathname === "/issues") {
    const body = await parseBody(req);
    required(body, ["tuneId", "sectionId", "type", "description"]);
    findTune(db, body.tuneId);
    const section = db.sections.find((item) => item.id === body.sectionId && item.tuneId === body.tuneId);
    if (!section) return send(res, 400, { error: "区间不存在或不属于该曲目" });
    const issue = {
      id: makeId("issue"),
      tuneId: body.tuneId,
      sectionId: body.sectionId,
      type: body.type,
      beat: body.beat === undefined ? null : Number(body.beat),
      lane: body.lane === undefined ? null : Number(body.lane),
      description: body.description,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null
    };
    db.issues.push(issue);
    await writeDb(db);
    return send(res, 201, { data: issue });
  }

  const issueStatusMatch = pathname.match(/^\/issues\/([^/]+)\/status$/);
  if (issueStatusMatch && req.method === "PATCH") {
    const issue = db.issues.find((item) => item.id === issueStatusMatch[1]);
    if (!issue) return send(res, 404, { error: "问题不存在" });
    const body = await parseBody(req);
    required(body, ["status"]);
    issue.status = body.status;
    issue.resolvedAt = body.status === "resolved" ? new Date().toISOString() : null;
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
    findTune(db, tuneId);
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
      findTune(db, tuneId);
    }

    const uncheckedSections = db.sections.filter(
      (s) => (!tuneId || s.tuneId === tuneId) && !s.checked
    );

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
    findTune(db, body.tuneId);
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
      }
    }

    await writeDb(db);
    return send(res, 200, {
      data: task,
      sectionChecked: body.checkSection === true
    });
  }

  return send(res, 404, { error: "接口不存在", routes });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => send(res, error.status || 500, { error: error.message || "服务器错误" }));
});

server.listen(PORT, () => {
  console.log(`Organ strip punch API running at http://127.0.0.1:${PORT}`);
});
