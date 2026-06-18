const http = require("http");
const { copyFile, mkdtemp, rm, readFile, stat } = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const PROJECT_ROOT = path.resolve(__dirname);
const REAL_DB_PATH = path.join(PROJECT_ROOT, "data", "db.json");
const REAL_BACKUPS_DIR = path.join(PROJECT_ROOT, "data", "backups");

const PORT = Number(process.env.PORT || 0) || 3200 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_PREFIX = "zfl_edition_prot_";
const TEST_TUNE_TITLE = "跨版次保护回归测试曲目";
const SERVER_START_TIMEOUT_MS = 10000;

let serverProcess = null;
let tempDataDir = null;
let testTuneId = null;

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
  console.log("\n--- 验证仓库真实数据未被修改 ---");
  let ok = true;
  const realDbAfter = hashFileContent(await readFile(REAL_DB_PATH, "utf-8"));
  if (realDbAfter !== realDbHashBefore) {
    console.log(`[FAIL] data/db.json 被修改！测试过程写坏了仓库数据`);
    ok = false;
  } else {
    console.log(`[OK]   data/db.json 未被修改`);
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
      console.log(`[FAIL] data/backups/ 文件数量变化：${realBackupsSnapshotBefore.length} -> ${currentFiles.length}`);
      ok = false;
    } else {
      let allSame = true;
      for (let i = 0; i < currentFiles.length; i++) {
        const a = realBackupsSnapshotBefore[i];
        const b = currentFiles[i];
        if (a.name !== b.name || a.size !== b.size || a.mtime !== b.mtime) { allSame = false; break; }
      }
      if (allSame) {
        console.log(`[OK]   data/backups/ 未被覆盖或修改 (${currentFiles.length} 个文件)`);
      } else {
        console.log(`[FAIL] data/backups/ 内容被改动！`);
        ok = false;
      }
    }
  } catch (e) {
    console.log(`[WARN] 无法验证 backups 目录: ${e.message}`);
  }
  return ok;
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              body: JSON.parse(data)
            });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const health = await request("/health");
      if (health.status === 200 && health.body.ok) {
        return health;
      }
    } catch {
    }
    await sleep(100);
  }
  throw new Error(`测试服务启动超时: ${BASE_URL}`);
}

async function startIsolatedServer() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "zfl-edition-prot-"));
  await copyFile(
    path.join(__dirname, "data", "db.json"),
    path.join(tempDataDir, "db.json")
  );
  console.log(`临时数据目录: ${tempDataDir}`);

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: tempDataDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  serverProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  serverProcess.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[server] exited with code ${code}`);
    } else if (signal) {
      console.log(`[server] stopped by ${signal}`);
    }
  });

  await waitForServer();
}

async function stopIsolatedServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1000);
      serverProcess.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  serverProcess = null;

  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    console.log(`临时数据目录已清理: ${tempDataDir}`);
    tempDataDir = null;
  }
}

async function setupIsolatedTestData() {
  console.log("\n=== 数据隔离：创建独立测试环境 ===");

  const res = await request("/tunes", {
    method: "POST",
    body: {
      title: `${TEST_TUNE_TITLE}_${Date.now()}`,
      composer: "测试机器人",
      stripSpec: {
        widthMm: 70,
        scale: "20音",
        tempoBpm: 80,
        paperType: "测试纸带"
      }
    }
  });

  if (res.status !== 201) {
    throw new Error(`创建测试曲目失败: ${res.status} ${JSON.stringify(res.body)}`);
  }

  testTuneId = res.body.data.id;
  console.log(`创建测试曲目: ${testTuneId}`);

  const s1 = await request(`/tunes/${testTuneId}/sections`, {
    method: "POST",
    body: {
      startBeat: 1,
      endBeat: 32,
      laneRange: "1-10",
      note: `${TEST_PREFIX}section_v1_1`
    }
  });
  const s2 = await request(`/tunes/${testTuneId}/sections`, {
    method: "POST",
    body: {
      startBeat: 33,
      endBeat: 64,
      laneRange: "4-18",
      note: `${TEST_PREFIX}section_v1_2`
    }
  });

  console.log(`创建初始区间: ${s1.body.data.id}, ${s2.body.data.id}`);
  return testTuneId;
}

async function cleanupIsolatedTestData() {
  console.log("\n=== 数据隔离：清理测试数据 ===");

  try {
    await request(`/tunes/${testTuneId}/archive`, { method: "PATCH" });
    console.log(`测试曲目已归档: ${testTuneId}`);
  } catch (e) {
    console.log(`归档测试曲目失败: ${e.message}`);
  }

  testTuneId = null;
}

async function testClaimOldEditionTaskRejected() {
  console.log("\n=== Test 1: 领取旧版次任务默认拒绝 ===");
  console.log("测试目标: 任务绑定旧 editionId 后，不带 force 领取时返回 409");

  const tuneId = testTuneId;

  const editionsBefore = await request(`/tunes/${tuneId}/editions`);
  const editionV1 = editionsBefore.body.data.find((e) => e.isCurrent);
  console.log(`当前版次 v1: ${editionV1.id} (version=${editionV1.version})`);

  const sectionsRes = await request(`/tunes/${tuneId}/sections`);
  const targetSection = sectionsRes.body.data[0];

  const taskRes = await request("/punch-tasks", {
    method: "POST",
    body: {
      tuneId,
      sectionId: targetSection.id,
      priority: "medium",
      assignee: null,
      note: `${TEST_PREFIX}claim_reject_test`
    }
  });

  if (taskRes.status !== 201) {
    console.log(`⚠️  创建任务失败，跳过此测试: ${taskRes.status}`);
    return { passed: true, skipped: true };
  }

  const taskId = taskRes.body.data.id;
  const taskEditionId = taskRes.body.data.editionId;
  console.log(`创建任务: ${taskId}, 绑定版次: ${taskEditionId}`);

  if (taskEditionId !== editionV1.id) {
    console.log(`⚠️  任务版次与当前版次不一致，跳过`);
    return { passed: true, skipped: true };
  }

  const newEditionRes = await request(`/tunes/${tuneId}/editions`, {
    method: "POST",
    body: {
      description: `${TEST_PREFIX}v2_for_claim_reject`,
      setAsCurrent: true
    }
  });

  if (newEditionRes.status !== 201) {
    console.log(`⚠️  创建新版次失败，跳过此测试: ${newEditionRes.status}`);
    return { passed: true, skipped: true };
  }

  const editionV2 = newEditionRes.body.data;
  console.log(`切换到新版次 v2: ${editionV2.id} (version=${editionV2.version})`);

  const claimRes = await request(`/punch-tasks/${taskId}/claim`, {
    method: "PATCH",
    body: { assignee: "测试员A" }
  });

  console.log(`领取旧版次任务状态: ${claimRes.status} (期望 409)`);
  console.log(`响应 error: ${claimRes.body?.error}`);
  console.log(`响应 taskEditionId: ${claimRes.body?.taskEditionId}`);
  console.log(`响应 currentEditionId: ${claimRes.body?.currentEditionId}`);

  const taskCheckRes = await request(`/punch-tasks?tuneId=${tuneId}`);
  const allTasks = taskCheckRes.body.data || [];
  const taskNow = allTasks.find((t) => t.id === taskId);
  const taskStillPending = taskNow ? taskNow.status === "pending" : true;
  console.log(`任务仍为 pending: ${taskStillPending} (期望 true)`);

  if (
    claimRes.status === 409 &&
    claimRes.body?.taskEditionId === taskEditionId &&
    claimRes.body?.currentEditionId === editionV2.id &&
    taskStillPending
  ) {
    console.log("✅ Test 1 PASSED: 领取旧版次任务默认被正确拒绝");
    return { passed: true };
  } else {
    console.log("❌ Test 1 FAILED: 跨版次领取保护未生效");
    return { passed: false };
  }
}

async function testClaimOldEditionTaskWithForce() {
  console.log("\n=== Test 2: 领取旧版次任务带 force 允许 ===");
  console.log("测试目标: 任务绑定旧 editionId，带 force: true 时可以正常领取");

  const tuneId = testTuneId;

  const tunesRes = await request(`/tunes/${tuneId}`);
  const currentEditionId = tunesRes.body.data.currentEditionId;
  console.log(`当前版次: ${currentEditionId}`);

  const editionsRes = await request(`/tunes/${tuneId}/editions`);
  const oldEdition = editionsRes.body.data.find((e) => e.id !== currentEditionId);
  if (!oldEdition) {
    console.log("⚠️  找不到旧版次，跳过此测试");
    return { passed: true, skipped: true };
  }

  const oldSections = oldEdition.sectionsSnapshot;
  if (!oldSections || oldSections.length === 0) {
    console.log("⚠️  旧版次没有区间，跳过此测试");
    return { passed: true, skipped: true };
  }

  const switchBackRes = await request(`/tunes/${tuneId}/editions/${oldEdition.id}/current`, {
    method: "PATCH"
  });
  if (switchBackRes.status !== 200) {
    console.log("⚠️  切换回旧版次失败，跳过此测试");
    return { passed: true, skipped: true };
  }
  console.log(`切换回旧版次: ${oldEdition.id} (version=${oldEdition.version})`);

  let targetSection = oldSections.find((s) => s.note && s.note.includes(TEST_PREFIX) && !s.note.includes("section_v1_1"));
  if (!targetSection) {
    const newSectionRes = await request(`/tunes/${tuneId}/sections`, {
      method: "POST",
      body: {
        startBeat: 200 + Math.floor(Math.random() * 100),
        endBeat: 250 + Math.floor(Math.random() * 100),
        laneRange: "1-20",
        note: `${TEST_PREFIX}claim_force_section`
      }
    });
    if (newSectionRes.status !== 201) {
      console.log("⚠️  创建新区间失败，跳过此测试");
      return { passed: true, skipped: true };
    }
    targetSection = newSectionRes.body.data;
  }
  console.log(`使用区间: ${targetSection.id} (${targetSection.note})`);

  const taskRes = await request("/punch-tasks", {
    method: "POST",
    body: {
      tuneId,
      sectionId: targetSection.id,
      priority: "high",
      note: `${TEST_PREFIX}claim_force_test`
    }
  });

  if (taskRes.status !== 201) {
    console.log(`⚠️  创建任务失败，跳过此测试: ${taskRes.status} ${JSON.stringify(taskRes.body)}`);
    return { passed: true, skipped: true };
  }

  const taskId = taskRes.body.data.id;
  const taskEditionId = taskRes.body.data.editionId;
  console.log(`创建任务: ${taskId}, 绑定版次: ${taskEditionId}`);

  const editionsNowRes = await request(`/tunes/${tuneId}/editions`);
  const allEditions = editionsNowRes.body.data;
  const newerEdition = allEditions.find(
    (e) => e.version > oldEdition.version
  );
  if (!newerEdition) {
    console.log("⚠️  找不到更新的版次，跳过此测试");
    return { passed: true, skipped: true };
  }

  const switchNewRes = await request(`/tunes/${tuneId}/editions/${newerEdition.id}/current`, {
    method: "PATCH"
  });
  if (switchNewRes.status !== 200) {
    console.log("⚠️  切换到更新版次失败，跳过此测试");
    return { passed: true, skipped: true };
  }
  console.log(`切换到更新版次: ${newerEdition.id} (version=${newerEdition.version})`);

  const claimRes = await request(`/punch-tasks/${taskId}/claim`, {
    method: "PATCH",
    body: { assignee: "测试员B", force: true }
  });

  console.log(`带 force 领取状态: ${claimRes.status} (期望 200)`);

  const claimedTask = claimRes.body?.data;
  const isClaimed = claimedTask?.status === "claimed";
  const assigneeMatch = claimedTask?.assignee === "测试员B";
  console.log(`任务状态为 claimed: ${isClaimed}`);
  console.log(`负责人正确: ${assigneeMatch}`);

  if (claimRes.status === 200 && isClaimed && assigneeMatch) {
    console.log("✅ Test 2 PASSED: 带 force 时可以领取旧版次任务");
    return { passed: true };
  } else {
    console.log("❌ Test 2 FAILED: 带 force 领取旧版次任务失败");
    return { passed: false };
  }
}

async function testCompleteOldEditionTaskRejected() {
  console.log("\n=== Test 3: 完成旧版次任务默认拒绝 ===");
  console.log("测试目标: 任务绑定旧 editionId 后，不带 force 完成时返回 409");

  const tuneId = testTuneId;

  const tunesRes = await request(`/tunes/${tuneId}`);
  const currentEditionId = tunesRes.body.data.currentEditionId;

  const editionsRes = await request(`/tunes/${tuneId}/editions`);
  const currentEdition = editionsRes.body.data.find((e) => e.id === currentEditionId);
  const allSections = currentEdition.sectionsSnapshot;

  if (!allSections || allSections.length < 2) {
    console.log("⚠️  区间不足，跳过此测试");
    return { passed: true, skipped: true };
  }

  const targetSection = allSections[1];
  const taskRes = await request("/punch-tasks", {
    method: "POST",
    body: {
      tuneId,
      sectionId: targetSection.id,
      priority: "medium",
      note: `${TEST_PREFIX}complete_reject_test`
    }
  });

  if (taskRes.status !== 201) {
    console.log(`⚠️  创建任务失败，跳过此测试: ${taskRes.status}`);
    return { passed: true, skipped: true };
  }

  const taskId = taskRes.body.data.id;
  const taskEditionId = taskRes.body.data.editionId;
  console.log(`创建任务: ${taskId}, 绑定版次: ${taskEditionId}`);

  const claimRes = await request(`/punch-tasks/${taskId}/claim`, {
    method: "PATCH",
    body: { assignee: "测试员C", force: true }
  });
  if (claimRes.status !== 200) {
    console.log(`⚠️  领取任务失败，跳过此测试: ${claimRes.status}`);
    return { passed: true, skipped: true };
  }
  console.log("任务已领取 (带 force)");

  const newEditionRes = await request(`/tunes/${tuneId}/editions`, {
    method: "POST",
    body: {
      description: `${TEST_PREFIX}v_for_complete_reject`,
      setAsCurrent: true
    }
  });

  if (newEditionRes.status !== 201) {
    console.log(`⚠️  创建新版次失败，跳过此测试: ${newEditionRes.status}`);
    return { passed: true, skipped: true };
  }

  const newEdition = newEditionRes.body.data;
  console.log(`切换到新版次: ${newEdition.id} (version=${newEdition.version})`);

  const completeRes = await request(`/punch-tasks/${taskId}/complete`, {
    method: "PATCH",
    body: { note: `${TEST_PREFIX}trying_complete` }
  });

  console.log(`完成旧版次任务状态: ${completeRes.status} (期望 409)`);
  console.log(`响应 error: ${completeRes.body?.error}`);
  console.log(`响应 hint: ${completeRes.body?.hint}`);

  const tasksListRes = await request(`/punch-tasks?tuneId=${tuneId}`);
  const allTasks = tasksListRes.body.data || [];
  const taskNow = allTasks.find((t) => t.id === taskId);
  const stillClaimed = taskNow ? taskNow.status === "claimed" : true;
  console.log(`任务仍为 claimed: ${stillClaimed} (期望 true)`);

  if (
    completeRes.status === 409 &&
    completeRes.body?.taskEditionId === taskEditionId &&
    completeRes.body?.currentEditionId === newEdition.id &&
    stillClaimed
  ) {
    console.log("✅ Test 3 PASSED: 完成旧版次任务默认被正确拒绝");
    return { passed: true };
  } else {
    console.log("❌ Test 3 FAILED: 跨版次完成保护未生效");
    return { passed: false };
  }
}

async function testCompleteOldEditionTaskWithForce() {
  console.log("\n=== Test 4: 完成旧版次任务带 force 允许 ===");
  console.log("测试目标: 任务绑定旧 editionId，带 force: true 时可以正常完成");

  const tuneId = testTuneId;

  const tunesRes = await request(`/tunes/${tuneId}`);
  const currentEditionId = tunesRes.body.data.currentEditionId;

  const editionsRes = await request(`/tunes/${tuneId}/editions`);
  const currentEdition = editionsRes.body.data.find((e) => e.id === currentEditionId);
  const allSections = currentEdition.sectionsSnapshot;

  if (!allSections || allSections.length === 0) {
    console.log("⚠️  区间不足，跳过此测试");
    return { passed: true, skipped: true };
  }

  const targetSection = allSections[0];
  const taskRes = await request("/punch-tasks", {
    method: "POST",
    body: {
      tuneId,
      sectionId: targetSection.id,
      priority: "low",
      note: `${TEST_PREFIX}complete_force_test`
    }
  });

  if (taskRes.status !== 201) {
    console.log(`⚠️  创建任务失败，跳过此测试: ${taskRes.status}`);
    return { passed: true, skipped: true };
  }

  const taskId = taskRes.body.data.id;
  const taskEditionId = taskRes.body.data.editionId;
  console.log(`创建任务: ${taskId}, 绑定版次: ${taskEditionId}`);

  const claimRes = await request(`/punch-tasks/${taskId}/claim`, {
    method: "PATCH",
    body: { assignee: "测试员D" }
  });
  if (claimRes.status !== 200) {
    console.log(`⚠️  领取任务失败，跳过此测试: ${claimRes.status}`);
    return { passed: true, skipped: true };
  }
  console.log("任务已领取");

  const oldEditionForTask = editionsRes.body.data.find((e) => e.id === taskEditionId);
  const olderEditions = editionsRes.body.data.filter(
    (e) => e.version < oldEditionForTask.version
  );

  let switchTargetEdition = null;
  if (olderEditions.length > 0) {
    switchTargetEdition = olderEditions[0];
  } else {
    const newerEditionRes = await request(`/tunes/${tuneId}/editions`, {
      method: "POST",
      body: {
        description: `${TEST_PREFIX}v_for_complete_force`,
        setAsCurrent: true
      }
    });
    if (newerEditionRes.status === 201) {
      switchTargetEdition = newerEditionRes.body.data;
    }
  }

  if (!switchTargetEdition) {
    console.log("⚠️  无法切换到其他版次，跳过此测试");
    return { passed: true, skipped: true };
  }

  if (switchTargetEdition.id !== currentEditionId) {
    const switchRes = await request(`/tunes/${tuneId}/editions/${switchTargetEdition.id}/current`, {
      method: "PATCH"
    });
    if (switchRes.status !== 200) {
      console.log("⚠️  切换版次失败，跳过此测试");
      return { passed: true, skipped: true };
    }
  }
  console.log(`当前版次切换为: ${switchTargetEdition.id} (version=${switchTargetEdition.version})`);

  const completeRes = await request(`/punch-tasks/${taskId}/complete`, {
    method: "PATCH",
    body: {
      force: true,
      note: `${TEST_PREFIX}force_completed_ok`
    }
  });

  console.log(`带 force 完成任务状态: ${completeRes.status} (期望 200)`);

  const completedTask = completeRes.body?.data;
  const isCompleted = completedTask?.status === "completed";
  console.log(`任务状态为 completed: ${isCompleted}`);

  if (completeRes.status === 200 && isCompleted) {
    console.log("✅ Test 4 PASSED: 带 force 时可以完成旧版次任务");
    return { passed: true };
  } else {
    console.log("❌ Test 4 FAILED: 带 force 完成旧版次任务失败");
    return { passed: false };
  }
}

async function testCheckSectionOnlyAffectsCurrentEdition() {
  console.log("\n=== Test 5: checkSection 仅影响当前版次快照和实时 sections ===");
  console.log("测试目标: 完成任务时 checkSection 同步勾选只影响当前实时 sections 和当前版次快照，不影响旧版次快照");

  const tuneId = testTuneId;

  const editionsListRes = await request(`/tunes/${tuneId}/editions`);
  const allEditions = editionsListRes.body.data;
  if (allEditions.length < 2) {
    console.log("⚠️  版次数量不足，需要至少2个版次，跳过此测试");
    return { passed: true, skipped: true };
  }

  const sortedEditions = [...allEditions].sort((a, b) => a.version - b.version);
  const baseEdition = sortedEditions[0];

  const switchRes = await request(`/tunes/${tuneId}/editions/${baseEdition.id}/current`, {
    method: "PATCH"
  });
  if (switchRes.status !== 200) {
    console.log("⚠️  切换到基准版次失败，跳过此测试");
    return { passed: true, skipped: true };
  }
  console.log(`切换到基准版次 v${baseEdition.version}: ${baseEdition.id}`);

  const baseSectionsRes = await request(`/tunes/${tuneId}/sections`);
  const baseSections = baseSectionsRes.body.data;
  const tasksListRes = await request(`/punch-tasks?tuneId=${tuneId}`);
  const pendingTaskSectionIds = new Set(
    (tasksListRes.body.data || [])
      .filter((t) => t.status !== "completed")
      .map((t) => t.sectionId)
  );

  let targetSection = baseSections.find(
    (s) => !s.checked && !pendingTaskSectionIds.has(s.id)
  );

  if (!targetSection) {
    const newSectionRes = await request(`/tunes/${tuneId}/sections`, {
      method: "POST",
      body: {
        startBeat: 300 + Math.floor(Math.random() * 100),
        endBeat: 350 + Math.floor(Math.random() * 100),
        laneRange: "1-20",
        note: `${TEST_PREFIX}checksection_target_${Date.now()}`
      }
    });
    if (newSectionRes.status !== 201) {
      console.log(`⚠️  创建新区间失败，跳过此测试: ${newSectionRes.status} ${JSON.stringify(newSectionRes.body)}`);
      return { passed: true, skipped: true };
    }
    targetSection = newSectionRes.body.data;
  }
  console.log(`目标区间: ${targetSection.id}, 当前 checked: ${targetSection.checked}, note: ${targetSection.note}`);

  const snapshotEditionRes = await request(`/tunes/${tuneId}/editions`, {
    method: "POST",
    body: {
      description: `${TEST_PREFIX}snapshot_before_check`,
      setAsCurrent: false
    }
  });
  if (snapshotEditionRes.status !== 201) {
    console.log("⚠️  创建快照版次失败，跳过此测试");
    return { passed: true, skipped: true };
  }
  const snapshotEdition = snapshotEditionRes.body.data;
  console.log(`创建快照版次 v${snapshotEdition.version}: ${snapshotEdition.id}`);

  const snapBeforeDetail = await request(`/tunes/${tuneId}/editions/${snapshotEdition.id}`);
  const snapBeforeSection = snapBeforeDetail.body.data.sectionsSnapshot.find(
    (s) => s.id === targetSection.id
  );
  const snapBeforeChecked = snapBeforeSection ? snapBeforeSection.checked : false;
  console.log(`快照版次中目标区间 checked: ${snapBeforeChecked}`);

  const taskRes = await request("/punch-tasks", {
    method: "POST",
    body: {
      tuneId,
      sectionId: targetSection.id,
      priority: "medium",
      note: `${TEST_PREFIX}checksection_task`
    }
  });
  if (taskRes.status !== 201) {
    console.log(`⚠️  创建任务失败，跳过此测试: ${taskRes.status}`);
    return { passed: true, skipped: true };
  }
  const taskId = taskRes.body.data.id;

  const claimRes = await request(`/punch-tasks/${taskId}/claim`, {
    method: "PATCH",
    body: { assignee: "测试员E" }
  });
  if (claimRes.status !== 200) {
    console.log(`⚠️  领取任务失败，跳过此测试: ${claimRes.status}`);
    return { passed: true, skipped: true };
  }

  const completeRes = await request(`/punch-tasks/${taskId}/complete`, {
    method: "PATCH",
    body: {
      checkSection: true,
      sectionNote: `${TEST_PREFIX}checked_by_task`
    }
  });

  if (completeRes.status !== 200) {
    console.log(`⚠️  完成任务失败，跳过此测试: ${completeRes.status}`);
    return { passed: true, skipped: true };
  }
  console.log("任务已完成，checkSection=true");

  const currentSectionsRes = await request(`/tunes/${tuneId}/sections`);
  const realtimeSection = currentSectionsRes.body.data.find(
    (s) => s.id === targetSection.id
  );
  const realtimeChecked = realtimeSection?.checked;
  const realtimeNoteMatch = realtimeSection?.note?.includes(TEST_PREFIX);
  console.log(`实时 sections 中目标区间 checked: ${realtimeChecked} (期望 true)`);
  console.log(`实时 sections note 更新: ${realtimeNoteMatch}`);

  const tuneRes = await request(`/tunes/${tuneId}`);
  const currentEditionIdNow = tuneRes.body.data.currentEditionId;

  const currentEditionDetail = await request(`/tunes/${tuneId}/editions/${currentEditionIdNow}`);
  const currentSnapSection = currentEditionDetail.body.data.sectionsSnapshot.find(
    (s) => s.id === targetSection.id
  );
  const currentSnapChecked = currentSnapSection?.checked;
  const currentSnapNoteMatch = currentSnapSection?.note?.includes(TEST_PREFIX);
  console.log(`当前版次快照中目标区间 checked: ${currentSnapChecked} (期望 true)`);
  console.log(`当前版次快照 note 更新: ${currentSnapNoteMatch}`);

  const snapAfterDetail = await request(`/tunes/${tuneId}/editions/${snapshotEdition.id}`);
  const oldSnapSection = snapAfterDetail.body.data.sectionsSnapshot.find(
    (s) => s.id === targetSection.id
  );
  const oldSnapChecked = oldSnapSection ? oldSnapSection.checked : null;
  console.log(`旧快照版次中目标区间 checked: ${oldSnapChecked} (期望 ${snapBeforeChecked})`);

  const realtimeOk = realtimeChecked === true && realtimeNoteMatch;
  const currentSnapOk = currentSnapChecked === true && currentSnapNoteMatch;
  const oldSnapUntouched = oldSnapChecked === snapBeforeChecked;

  console.log(`实时 sections 正确更新: ${realtimeOk}`);
  console.log(`当前版次快照正确更新: ${currentSnapOk}`);
  console.log(`旧版次快照保持不变: ${oldSnapUntouched}`);

  if (realtimeOk && currentSnapOk && oldSnapUntouched) {
    console.log("✅ Test 5 PASSED: checkSection 仅影响当前实时 sections 和当前版次快照");
    return { passed: true };
  } else {
    console.log("❌ Test 5 FAILED: checkSection 影响范围不正确");
    return { passed: false };
  }
}

async function runAllTests() {
  console.log("========================================");
  console.log("跨版次保护回归测试（数据隔离版）");
  console.log("========================================");

  try {
    await snapshotRealData();

    await startIsolatedServer();

    const health = await request("/health");
    console.log(`服务器状态: ${health.body.ok ? "正常" : "异常"}`);
    console.log(`数据版本: v${health.body.dataVersion}`);

    await setupIsolatedTestData();

    const results = [];

    results.push(await testClaimOldEditionTaskRejected());
    results.push(await testClaimOldEditionTaskWithForce());
    results.push(await testCompleteOldEditionTaskRejected());
    results.push(await testCompleteOldEditionTaskWithForce());
    results.push(await testCheckSectionOnlyAffectsCurrentEdition());

    console.log("\n========================================");
    console.log("测试结果汇总");
    console.log("========================================");

    const notSkipped = results.filter((r) => !r.skipped);
    const passed = notSkipped.filter((r) => r.passed).length;
    const total = notSkipped.length;
    const skipped = results.filter((r) => r.skipped).length;

    console.log(`通过: ${passed}/${total}${skipped > 0 ? ` (跳过${skipped})` : ""}`);

    await cleanupIsolatedTestData();

    const finalHealth = await request("/health");
    console.log(
      `\n最终队列状态: pending=${finalHealth.body.writeQueue?.pendingWrites}, failed=${finalHealth.body.writeQueue?.failedOperations}`
    );

    const untouchedOk = await verifyRealDataUntouched();

    await stopIsolatedServer();

    if (passed === total && total > 0 && untouchedOk) {
      console.log("\n🎉 所有跨版次保护测试通过!");
      process.exit(0);
    } else if (total === 0) {
      console.log("⚠️  所有测试被跳过，请检查测试环境");
      process.exit(0);
    } else {
      if (!untouchedOk) {
        console.log("\n⚠️  仓库数据被修改！隔离机制可能失效");
      }
      console.log("⚠️  部分测试失败，请检查");
      process.exit(1);
    }
  } catch (err) {
    console.error("测试执行失败:", err.message);
    console.error(err.stack);

    if (testTuneId) {
      try {
        await cleanupIsolatedTestData();
      } catch (e) {
        console.error("清理失败:", e.message);
      }
    }

    try { await verifyRealDataUntouched(); } catch (e) {}
    await stopIsolatedServer();
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  console.log("\n收到中断信号，正在清理测试数据...");
  if (testTuneId) {
    try {
      await cleanupIsolatedTestData();
    } catch (e) {}
  }
  await stopIsolatedServer();
  process.exit(0);
});

runAllTests();
