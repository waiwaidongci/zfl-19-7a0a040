const http = require("http");
const { mkdtemp, rm, writeFile, readFile, stat, mkdir } = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const REAL_DATA_DIR = path.join(PROJECT_ROOT, "data");
const REAL_DB_PATH = path.join(REAL_DATA_DIR, "db.json");
const REAL_BACKUPS_DIR = path.join(REAL_DATA_DIR, "backups");
const CURRENT_DATA_VERSION = 7;

const BASE_PORT = 3400 + Math.floor(Math.random() * 600);
const SERVER_START_TIMEOUT_MS = 15000;

let serverProcess = null;
let tempDataDir = null;
let realDbHashBefore = null;
let realBackupsSnapshotBefore = null;

function hashFileContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function snapshotRealData() {
  realDbHashBefore = hashFileContent(await readFile(REAL_DB_PATH, "utf-8"));
  const backupFiles = [];
  try {
    const { readdirSync } = require("fs");
    const files = readdirSync(REAL_BACKUPS_DIR);
    for (const f of files) {
      const fp = path.join(REAL_BACKUPS_DIR, f);
      const s = await stat(fp);
      backupFiles.push({ name: f, size: s.size, mtime: s.mtimeMs });
    }
  } catch (e) {}
  realBackupsSnapshotBefore = backupFiles;
}

async function verifyRealDataUntouched() {
  let ok = true;
  const realDbAfter = hashFileContent(await readFile(REAL_DB_PATH, "utf-8"));
  if (realDbAfter !== realDbHashBefore) {
    console.log(`  [FAIL] data/db.json 被修改！`);
    ok = false;
  } else {
    console.log(`  [OK]   data/db.json 未被修改`);
  }
  try {
    const { readdirSync } = require("fs");
    const files = readdirSync(REAL_BACKUPS_DIR);
    const currentFiles = [];
    for (const f of files) {
      const fp = path.join(REAL_BACKUPS_DIR, f);
      const s = await stat(fp);
      currentFiles.push({ name: f, size: s.size, mtime: s.mtimeMs });
    }
    if (currentFiles.length !== realBackupsSnapshotBefore.length) {
      console.log(`  [FAIL] data/backups/ 文件数量变化`);
      ok = false;
    } else {
      let allSame = true;
      for (let i = 0; i < currentFiles.length; i++) {
        const a = realBackupsSnapshotBefore[i];
        const b = currentFiles[i];
        if (a.name !== b.name || a.size !== b.size || a.mtime !== b.mtime) {
          allSame = false; break;
        }
      }
      if (allSame) {
        console.log(`  [OK]   data/backups/ 未被覆盖 (${currentFiles.length} 个文件)`);
      } else {
        console.log(`  [FAIL] data/backups/ 内容被改动！`);
        ok = false;
      }
    }
  } catch (e) {}
  return ok;
}

function request(baseUrl, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: { "Content-Type": "application/json", ...options.headers }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch (e) { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(baseUrl) {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const h = await request(baseUrl, "/health");
      if (h.status === 200 && h.body.ok) return h;
    } catch {}
    await sleep(100);
  }
  throw new Error(`服务启动超时: ${baseUrl}`);
}

async function startIsolatedServerWithData(port, dbContent) {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), `zfl-mig-v${dbContent._dataVersion || 0}-`));
  await mkdir(path.join(tempDataDir, "backups"), { recursive: true });
  await writeFile(path.join(tempDataDir, "db.json"), JSON.stringify(dbContent, null, 2));
  const baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tempDataDir },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let serverLog = "";
  serverProcess.stdout.on("data", (c) => { serverLog += c.toString(); });
  serverProcess.stderr.on("data", (c) => { serverLog += c.toString(); });
  serverProcess._log = () => serverLog;

  await waitForServer(baseUrl);
  return { baseUrl, tempDir: tempDataDir };
}

async function stopIsolatedServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      const to = setTimeout(resolve, 2000);
      serverProcess.once("exit", () => { clearTimeout(to); resolve(); });
    });
  }
  serverProcess = null;
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = null;
  }
}

function makeV0Data() {
  return {
    tunes: [
      { id: "tune_v0_1", title: "v0测试曲目", composer: "远古用户", createdAt: "2024-01-01T00:00:00.000Z",
        stripSpec: { widthMm: 70, scale: "20音", tempoBpm: 80, paperType: "普通纸带" } }
    ],
    sections: [
      { id: "sec_v0_1", tuneId: "tune_v0_1", startBeat: 1, endBeat: 32, laneRange: "1-10" }
    ],
    issues: [
      { id: "iss_v0_1", tuneId: "tune_v0_1", sectionId: "sec_v0_1", type: "漏孔", beat: 5, lane: 3, description: "v0老问题", status: "resolved" }
    ],
    punchTasks: [],
    playSessions: []
  };
}

function makeV1Data() {
  return {
    _dataVersion: 1,
    tunes: [
      { id: "tune_v1_1", title: "v1测试曲", composer: "用户A", templateId: null, templateNameSnapshot: null, currentEditionId: "ed_v1_1", archived: false, archivedAt: null, createdAt: "2024-02-01T00:00:00.000Z",
        stripSpec: { widthMm: 70, scale: "20音", tempoBpm: 80, paperType: "普通纸带" } }
    ],
    tapeEditions: [
      { id: "ed_v1_1", tuneId: "tune_v1_1", version: 1, source: "initial", sourceEditionId: null, description: "v1版", sectionsSnapshot: [], isCurrent: true, createdAt: "2024-02-01T00:00:00.000Z" }
    ],
    sections: [
      { id: "sec_v1_1", tuneId: "tune_v1_1", startBeat: 1, endBeat: 16, laneRange: "1-20", checked: false, note: "" },
      { id: "sec_v1_bad", tuneId: "ghost_tune", startBeat: 1, endBeat: 8, laneRange: "1-5", checked: false, note: "悬挂引用" }
    ],
    issues: [
      { id: "iss_v1_1", tuneId: "tune_v1_1", sectionId: "sec_v1_1", editionId: "ed_v1_1", type: "错孔", beat: 10, lane: 5, description: "v1问题", status: "open", fixDescription: null, fixTime: null, reviewNote: null, resolvedAt: null, createdAt: "2024-02-01T00:00:00.000Z" },
      { id: "iss_v1_dangling", tuneId: "tune_v1_1", sectionId: "sec_ghost", editionId: "ed_v1_1", type: "漏孔", beat: 1, lane: 1, description: "悬挂section引用", status: "open", fixDescription: null, fixTime: null, reviewNote: null, resolvedAt: null, createdAt: "2024-02-01T00:00:00.000Z" }
    ],
    punchTasks: [
      { id: "task_v1_1", tuneId: "tune_v1_1", sectionId: "sec_v1_1", priority: "INVALID_PRIO", assignee: null, status: "WEIRD_STATUS", createdAt: "2024-02-01T00:00:00.000Z", claimedAt: null, completedAt: null, note: "" }
    ],
    playSessions: [],
    stripSpecTemplates: [],
    reportSnapshots: []
  };
}

function makeV2Data() {
  return {
    _dataVersion: 2,
    tunes: [
      { id: "tune_v2_1", title: "v2曲", composer: "用户B", templateId: null, templateNameSnapshot: null, currentEditionId: "ed_v2_curr", archived: false, archivedAt: null, createdAt: "2024-03-01T00:00:00.000Z",
        stripSpec: { widthMm: 70, scale: "20音", tempoBpm: 80, paperType: "普通纸带" } }
    ],
    tapeEditions: [
      { id: "ed_v2_curr", tuneId: "tune_v2_1", version: 1, source: "initial", sourceEditionId: null, description: "curr", sectionsSnapshot: [{ id: "sec_v2_1", tuneId: "tune_v2_1", startBeat: 1, endBeat: 16, laneRange: "1-10", checked: false, note: "" }], isCurrent: true, createdAt: "2024-03-01T00:00:00.000Z" },
      { id: "ed_v2_old", tuneId: "tune_v2_1", version: 2, source: "manual", sourceEditionId: "ed_v2_curr", description: "old", sectionsSnapshot: [{ id: "sec_v2_1", tuneId: "tune_v2_1", startBeat: 1, endBeat: 16, laneRange: "1-10", checked: false, note: "" }], isCurrent: false, createdAt: "2024-03-02T00:00:00.000Z" }
    ],
    sections: [
      { id: "sec_v2_1", tuneId: "tune_v2_1", startBeat: 1, endBeat: 16, laneRange: "1-10", checked: false, note: "" }
    ],
    issues: [
      { id: "iss_v2_1", tuneId: "tune_v2_1", sectionId: "sec_v2_1", editionId: "ed_v2_old", type: "漏孔", beat: 5, lane: 3, description: "旧版次问题", status: "open", fixDescription: null, fixTime: null, reviewNote: null, resolvedAt: null, createdAt: "2024-03-01T00:00:00.000Z", timeline: [{ status: "open", fromStatus: null, at: "2024-03-01T00:00:00.000Z", note: "创建" }] }
    ],
    punchTasks: [],
    playSessions: [],
    stripSpecTemplates: [
      { id: "tpl_20_standard", name: "标准纸带", stripSpec: { widthMm: 70, scale: "20音", tempoBpm: 80, paperType: "普通纸带" }, createdAt: "2024-03-01T00:00:00.000Z", updatedAt: "2024-03-01T00:00:00.000Z" }
    ],
    reportSnapshots: []
  };
}

function makeV3Data() {
  const d = makeV2Data();
  d._dataVersion = 3;
  return d;
}

function makeV4Data() {
  const d = makeV3Data();
  d._dataVersion = 4;
  return d;
}

function makeV5Data() {
  const d = makeV4Data();
  d._dataVersion = 5;
  return d;
}

function makeV6Data() {
  const d = makeV5Data();
  d._dataVersion = 6;
  d.tunes[0].dueAt = undefined;
  if (!d.punchTasks) d.punchTasks = [];
  d.punchTasks.push({
    id: "task_v6_1", tuneId: d.tunes[0].id, sectionId: d.sections[0].id,
    editionId: d.tapeEditions[0].id, priority: "medium", assignee: null,
    status: "pending", createdAt: "2024-06-01T00:00:00.000Z",
    claimedAt: null, completedAt: null, note: "v6任务",
    originalAssignee: null, transferHistory: [], lastTransferredAt: null, lastTransferNote: null
  });
  return d;
}

const TEST_SCENARIOS = [
  { name: "v0 → v7 (最老无版本号数据)", build: makeV0Data, expectFrom: 0 },
  { name: "v1 → v7 (含悬挂引用)", build: makeV1Data, expectFrom: 1 },
  { name: "v2 → v7 (含旧版次问题)", build: makeV2Data, expectFrom: 2 },
  { name: "v3 → v7", build: makeV3Data, expectFrom: 3 },
  { name: "v4 → v7", build: makeV4Data, expectFrom: 4 },
  { name: "v5 → v7", build: makeV5Data, expectFrom: 5 },
  { name: "v6 → v7 (最新前一版)", build: makeV6Data, expectFrom: 6 }
];

async function testMigrationScenario(scenario, portOffset) {
  const port = BASE_PORT + portOffset;
  const data = scenario.build();
  console.log(`\n=== 迁移场景: ${scenario.name} ===`);
  console.log(`  源数据版本: v${data._dataVersion || 0}, 端口: ${port}`);

  const { baseUrl, tempDir } = await startIsolatedServerWithData(port, data);

  const health = await request(baseUrl, "/health");
  const finalVersion = health.body.dataVersion;
  console.log(`  迁移后版本: v${finalVersion}`);

  if (finalVersion !== CURRENT_DATA_VERSION) {
    throw new Error(`期望迁移到 v${CURRENT_DATA_VERSION}，实际 v${finalVersion}`);
  }
  console.log(`  [OK] 版本号正确: v${scenario.expectFrom} → v${finalVersion}`);

  const dbAfter = JSON.parse(await readFile(path.join(tempDir, "db.json"), "utf-8"));
  if (!dbAfter._dataVersion || dbAfter._dataVersion !== CURRENT_DATA_VERSION) {
    throw new Error("磁盘上 db.json 未写入新版本号");
  }
  console.log(`  [OK] 磁盘 db.json 已写入 v${CURRENT_DATA_VERSION}`);

  const tunes = await request(baseUrl, "/tunes");
  if (tunes.status !== 200 || !Array.isArray(tunes.body.data)) {
    throw new Error(`/tunes 返回异常: status=${tunes.status}, body=${JSON.stringify(tunes.body).slice(0, 300)}`);
  }
  console.log(`  [OK] /tunes 返回 ${tunes.body.data.length} 条曲目`);

  const templates = await request(baseUrl, "/strip-spec-templates");
  if (templates.status !== 200 || !Array.isArray(templates.body.data)) {
    throw new Error(`stripSpecTemplates 迁移失败: status=${templates.status}, body=${JSON.stringify(templates.body).slice(0, 200)}`);
  }
  console.log(`  [OK] 模板列表正常: ${templates.body.data.length} 个模板`);

  await stopIsolatedServer();
  console.log(`  ✅ 场景 "${scenario.name}" 通过`);
  return { name: scenario.name, passed: true };
}

async function main() {
  console.log("========================================");
  console.log("数据迁移兼容检查 (临时DATA_DIR隔离)");
  console.log(`目标版本: v${CURRENT_DATA_VERSION}`);
  console.log("========================================");

  await snapshotRealData();

  const results = [];
  let portOffset = 0;
  try {
    for (const scenario of TEST_SCENARIOS) {
      const r = await testMigrationScenario(scenario, portOffset);
      results.push(r);
      portOffset += 10;
    }

    console.log("\n========================================");
    console.log("迁移兼容检查结果汇总");
    console.log("========================================");
    for (const r of results) {
      console.log(`  ${r.passed ? "✅" : "❌"} ${r.name}`);
    }

    const untouchedOk = await verifyRealDataUntouched();

    const allPassed = results.every((r) => r.passed);
    if (allPassed && untouchedOk) {
      console.log(`\n🎉 全部 ${results.length} 个迁移场景通过！仓库数据完整`);
      process.exit(0);
    } else {
      console.log(`\n⚠️  迁移兼容检查失败`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n💥 迁移检查失败: ${err.message}`);
    console.error(err.stack);
    if (serverProcess && serverProcess._log) {
      const log = serverProcess._log();
      if (log) {
        console.error("\n--- 服务端日志 ---");
        console.error(log);
      }
    }
    try { await verifyRealDataUntouched(); } catch (e) {}
    await stopIsolatedServer();
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  console.log("\n收到中断信号，清理中...");
  await stopIsolatedServer();
  process.exit(130);
});

main();
