# 手摇风琴纸带打孔API

纯后端零依赖Node服务，使用 `data/db.json` 持久化曲目、纸带区间和试奏问题。

## 启动

```bash
PORT=3019 node server.js
```

## 主要接口

### 健康检查
- `GET /health`

### 曲目管理
- `GET /tunes`
- `POST /tunes`（支持 `templateId` 引用模板，自动填充 stripSpec 快照）
- `GET /tunes/:id/progress`
- `GET /tunes/:id/sections`
- `POST /tunes/:id/sections`
- `GET /tunes/:id/unchecked-sections`

### 区间管理
- `PATCH /sections/:id/check`（标记区间检查状态，同步更新当前版次快照）
- `PUT /sections/:id`（更新区间拍点范围、音轨范围、检查状态和备注，同步更新当前版次快照）

### 问题管理
- `GET /issues?tuneId=&status=`
- `POST /issues`
- `PATCH /issues/:id/status`

### 纸带规格模板
- `GET /strip-spec-templates?scale=`（模板列表，可选按音阶筛选）
- `GET /strip-spec-templates/:id`（模板详情）
- `POST /strip-spec-templates`（创建新模板）
- `PUT /strip-spec-templates/:id`（更新模板，更新只影响后续新建曲目，已创建曲目保留快照不被回写）

### 打孔任务队列
- `GET /punch-tasks?tuneId=&status=&priority=&assignee=&onlyUnassigned=`（查询任务，支持多条件筛选，结果按优先级+创建时间排序）
- `POST /punch-tasks/generate`（从未检查区间批量生成待处理任务，支持指定曲目和默认优先级）
- `POST /punch-tasks`（手动创建单个任务）
- `PATCH /punch-tasks/:id/claim`（领取任务，指定负责人）
- `PATCH /punch-tasks/:id/complete`（完成任务，可选 `checkSection: true` 同步标记区间为已检查）

**任务状态说明**：`pending`（待领取）→ `claimed`（已领取/进行中）→ `completed`（已完成）

**优先级**：`low`（低）、`medium`（中，默认）、`high`（高）、`urgent`（紧急）

### 纸带版次管理
- `GET /tunes/:id/editions`（版次列表，按版本号升序）
- `POST /tunes/:id/editions`（创建新版次，支持 `sourceEditionId` 从指定版次复制，`setAsCurrent: true/false`）
- `GET /tunes/:id/editions/:editionId`（版次详情）
- `PATCH /tunes/:id/editions/:editionId/current`（设为当前版次，同步覆盖实时区间）
- `GET /tunes/:id/editions/:baseEditionId/compare/:targetEditionId`（对比两个版次差异）

**版次对比接口返回结构说明**：

| 字段 | 说明 |
|------|------|
| `baseEdition` | 基准版次信息 |
| `targetEdition` | 目标版次信息 |
| `sectionDiff.added` | 新增区间清单 |
| `sectionDiff.removed` | 删除区间清单 |
| `sectionDiff.beatChanges` | 拍点变化区间清单（含 base/target 对比） |
| `sectionDiff.laneRangeChanges` | 音轨范围变化区间清单 |
| `sectionDiff.checkedStatusChanges` | 检查状态变化区间清单 |
| `sectionDiff.summary` | 区间变化统计 |
| `issueDiff.statusDiff` | 各状态问题数量对比 |
| `issueDiff.typeDiff` | 各类型问题数量对比 |
| `issueDiff.newIssues` | 目标版次新增问题清单 |
| `issueDiff.resolvedIssues` | 从基准到目标已解决问题清单 |
| `issueDiff.summary` | 问题变化统计 |

**从复制版次到查看差异再设为当前版次示例**：

```bash
# 1. 基于当前曲目的v1版次复制出一个新版本，但先不设为当前版次
NEW_EDITION=$(curl -s -X POST http://127.0.0.1:3019/tunes/tune_demo/editions \
  -H 'Content-Type: application/json' \
  -d '{
    "sourceEditionId": "edition_demo_init",
    "description": "v2校对修改版",
    "setAsCurrent": false
  }')
NEW_EDITION_ID=$(echo "$NEW_EDITION" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

# 2. 对比基准版次和新复制版次，查看区间变化与关联问题差异
curl -s http://127.0.0.1:3019/tunes/tune_demo/editions/edition_demo_init/compare/$NEW_EDITION_ID \
  | python3 -m json.tool

# 3. 差异确认后，将新版本设为当前版次并同步覆盖实时区间
curl -s -X PATCH http://127.0.0.1:3019/tunes/tune_demo/editions/$NEW_EDITION_ID/current \
  | python3 -m json.tool
```

### 纸带校对报告
- `GET /tunes/:id/report`（按当前实时数据生成校对报告，不持久化）
- `POST /tunes/:id/report/snapshot`（将当前实时报告保存为历史快照，可选 `label` 标记）
- `GET /tunes/:id/report/snapshots`（查询该曲目的所有报告快照列表，按创建时间倒序）
- `GET /report-snapshots/:id`（查询指定报告快照的完整内容）

**报告结构说明**：

| 字段 | 说明 |
|------|------|
| `stripSpec` | 曲目纸带规格（宽度/音阶/速度/纸张类型） |
| `coverage` | 区间检查覆盖率（总数/已检查/未检查/百分比） |
| `uncheckedSectionDetails` | 未检查区间列表（含拍号范围和音轨范围） |
| `openIssueDetails` | 未关闭问题列表（含类型/位置/描述/状态） |
| `issueCountByType` | 按问题类型统计数量（如 `{"漏孔":2,"错孔":1}`） |
| `summary` | 问题汇总（总数/未关闭/已关闭） |
| `suggestedNextSteps` | 建议下一步处理顺序（按优先级排序，含动作类型和说明） |

## 纸带规格模板说明

模板用于快速应用常用纸带规格。创建曲目时引用模板，`stripSpec` 会保存为**当时的快照**（`templateId` 和 `templateNameSnapshot`），后续对模板的修改**不会影响**已创建曲目。

默认内置 5 种 20 音纸带模板：

| 模板ID | 名称 | 规格 |
|--------|------|------|
| `tpl_20_standard` | 20音标准纸带 | 70mm / 20音 / 80BPM / 普通纸带 |
| `tpl_20_semitrans` | 20音半透明纸带 | 70mm / 20音 / 82BPM / 半透明纸带 |
| `tpl_20_thick` | 20音加厚纸带 | 72mm / 20音 / 76BPM / 加厚纸带 |
| `tpl_20_slow` | 20音慢速练习纸带 | 70mm / 20音 / 70BPM / 普通纸带 |
| `tpl_20_performance` | 20音演出纸带 | 70mm / 20音 / 88BPM / 半透明纸带 |

## 闭环示例

```bash
# 查看曲目进度
curl http://127.0.0.1:3019/tunes/tune_demo/progress

# 上报问题
curl -X POST http://127.0.0.1:3019/issues \
  -H 'Content-Type: application/json' \
  -d '{"tuneId":"tune_demo","sectionId":"section_demo_2","type":"错孔","beat":45,"lane":9,"description":"第45拍第9轨多打孔"}'

# ---------- 问题复核流程示例 ----------

# 1. 首先创建一个问题（状态初始为 open）
NEW_ISSUE=$(curl -s -X POST http://127.0.0.1:3019/issues \
  -H 'Content-Type: application/json' \
  -d '{
    "tuneId": "tune_demo",
    "sectionId": "section_demo_2",
    "type": "漏孔",
    "beat": 41,
    "lane": 12,
    "description": "第41拍高音孔漏打"
  }')
echo "新问题: $NEW_ISSUE"
ISSUE_ID=$(echo $NEW_ISSUE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "问题ID: $ISSUE_ID"

# 2. 查看曲目进度（openIssues 应包含此问题）
echo "===== 修复前进度 ====="
curl http://127.0.0.1:3019/tunes/tune_demo/progress

# 3. 提交修复（open → fixed，必须填写 fixDescription）
echo "===== 提交修复 ====="
curl -s -X PATCH http://127.0.0.1:3019/issues/$ISSUE_ID/status \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "fixed",
    "fixDescription": "已重新打孔第41拍第12轨高音孔"
  }' | python3 -m json.tool

# 4. 查看进度（仍算 openIssues，未计入 resolved）
echo "===== 已修复待复核进度 ====="
curl http://127.0.0.1:3019/tunes/tune_demo/progress

# 5. 复核通过（fixed → verified，可选填写 reviewNote）
echo "===== 复核通过 ====="
curl -s -X PATCH http://127.0.0.1:3019/issues/$ISSUE_ID/status \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "verified",
    "reviewNote": "试奏确认高音已正确发声"
  }' | python3 -m json.tool

# 6. 查看进度（openIssues 减少，resolvedIssues 增加）
echo "===== 复核通过后进度 ====="
curl http://127.0.0.1:3019/tunes/tune_demo/progress

# ---------- 复核失败重新打开示例 ----------

# 1. 创建另一个问题
NEW_ISSUE2=$(curl -s -X POST http://127.0.0.1:3019/issues \
  -H 'Content-Type: application/json' \
  -d '{
    "tuneId": "tune_demo",
    "sectionId": "section_demo_2",
    "type": "错孔",
    "beat": 50,
    "lane": 8,
    "description": "第50拍第8轨孔位偏移"
  }')
ISSUE_ID2=$(echo $NEW_ISSUE2 | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

# 2. 提交修复
curl -s -X PATCH http://127.0.0.1:3019/issues/$ISSUE_ID2/status \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "fixed",
    "fixDescription": "已调整打孔位置"
  }' > /dev/null

# 3. 复核失败，重新打开（必须填写 reviewNote 说明失败原因）
echo "===== 复核失败，重新打开 ====="
curl -s -X PATCH http://127.0.0.1:3019/issues/$ISSUE_ID2/status \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "reopened",
    "reviewNote": "孔位仍有偏差，第50拍试奏时音高不正确，请重新调整"
  }' | python3 -m json.tool

# 4. 重新提交修复
echo "===== 重新提交修复 ====="
curl -s -X PATCH http://127.0.0.1:3019/issues/$ISSUE_ID2/status \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "fixed",
    "fixDescription": "重新校准打孔机位置，偏移量已修正0.5mm"
  }' | python3 -m json.tool

# 5. 再次复核通过
echo "===== 再次复核通过 ====="
curl -s -X PATCH http://127.0.0.1:3019/issues/$ISSUE_ID2/status \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "verified",
    "reviewNote": "音高正确，确认修复完成"
  }' | python3 -m json.tool

# 6. 按状态查询问题
echo "===== 所有 verified 状态问题 ====="
curl "http://127.0.0.1:3019/issues?tuneId=tune_demo&status=verified"

# 向后兼容：使用旧的 resolved 状态查询（自动映射为 verified）
echo "===== 使用 resolved 查询（向后兼容） ====="
curl "http://127.0.0.1:3019/issues?tuneId=tune_demo&status=resolved"

# ---------- 纸带规格模板使用示例 ----------

# 1. 获取所有模板列表
curl http://127.0.0.1:3019/strip-spec-templates

# 2. 仅获取20音模板（筛选）
curl "http://127.0.0.1:3019/strip-spec-templates?scale=20音"

# 3. 创建自定义模板
curl -X POST http://127.0.0.1:3019/strip-spec-templates \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "20音私人定制",
    "description": "专属定制规格",
    "stripSpec": {
      "widthMm": 75,
      "scale": "20音",
      "tempoBpm": 85,
      "paperType": "进口纸带"
    }
  }'

# 3b. 查看模板详情
curl http://127.0.0.1:3019/strip-spec-templates/tpl_20_standard

# 3c. 更新模板（只影响后续新建曲目，已创建曲目保留快照）
curl -X PUT http://127.0.0.1:3019/strip-spec-templates/tpl_20_standard \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "20音标准纸带V2",
    "stripSpec": {
      "widthMm": 70,
      "scale": "20音",
      "tempoBpm": 82,
      "paperType": "普通纸带"
    }
  }'

# 4. 按模板创建曲目（stripSpec 自动从模板快照填充）
curl -X POST http://127.0.0.1:3019/tunes \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "春日序曲",
    "composer": "未知",
    "templateId": "tpl_20_performance"
  }'

# 5. 按模板创建 + 覆盖部分规格字段
curl -X POST http://127.0.0.1:3019/tunes \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "慢板乐章",
    "templateId": "tpl_20_standard",
    "stripSpec": {
      "tempoBpm": 60
    }
  }'

# 6. 传统方式：直接传入 stripSpec 创建（不使用模板）
curl -X POST http://127.0.0.1:3019/tunes \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "自由曲目",
    "stripSpec": {
      "widthMm": 70,
      "scale": "20音",
      "tempoBpm": 80,
      "paperType": "普通纸带"
    }
  }'

# ---------- 曲目列表查询筛选示例 ----------

# 1. 默认查询：只返回未归档曲目
echo "===== 默认查询（未归档） ====="
curl http://127.0.0.1:3019/tunes

# 2. 按标题模糊搜索（大小写不敏感）
echo "===== 按标题搜索含'华尔兹'的曲目 ====="
curl "http://127.0.0.1:3019/tunes?title=华尔兹"

# 3. 按作曲者搜索
echo "===== 按作曲者搜索'李明' ====="
curl "http://127.0.0.1:3019/tunes?composer=李明"

# 4. 按纸带规格模板ID筛选
echo "===== 使用半透明纸带模板的曲目 ====="
curl "http://127.0.0.1:3019/tunes?templateId=tpl_20_semitrans"

# 5. 按纸带规格模板名称模糊筛选
echo "===== 模板名称含'演出'的曲目 ====="
curl "http://127.0.0.1:3019/tunes?templateName=演出"

# 6. 按完成进度区间筛选：进度 >= 50%
echo "===== 完成进度 50% 以上的曲目 ====="
curl "http://127.0.0.1:3019/tunes?progressMin=50"

# 7. 按完成进度区间筛选：进度 < 30%（未完成较多）
echo "===== 完成进度 30% 以下的曲目 ====="
curl "http://127.0.0.1:3019/tunes?progressMax=29"

# 8. 按进度区间筛选：40% ~ 70% 之间
echo "===== 完成进度 40%-70% 的曲目 ====="
curl "http://127.0.0.1:3019/tunes?progressMin=40&progressMax=70"

# 9. 组合筛选：标题含'曲' + 进度 >= 20% + 未归档
echo "===== 组合筛选示例 ====="
curl "http://127.0.0.1:3019/tunes?title=曲&progressMin=20"

# 10. 查询所有已归档曲目
echo "===== 已归档曲目 ====="
curl "http://127.0.0.1:3019/tunes?archived=true"

# 11. 查询所有曲目（包括归档和未归档）
echo "===== 全部曲目（含归档） ====="
curl "http://127.0.0.1:3019/tunes?archived=all"

# ---------- 打孔任务队列闭环示例：从区间创建到任务完成 ----------

# 1. 先创建一个新曲目
NEW_TUNE=$(curl -s -X POST http://127.0.0.1:3019/tunes \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "夏夜小夜曲",
    "templateId": "tpl_20_semitrans"
  }')
echo "新曲目: $NEW_TUNE"
TUNE_ID=$(echo $NEW_TUNE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "曲目ID: $TUNE_ID"

# 2. 为该曲目创建多个纸带区间（其中两个未检查）
curl -X POST http://127.0.0.1:3019/tunes/$TUNE_ID/sections \
  -H 'Content-Type: application/json' \
  -d '{
    "startBeat": 1,
    "endBeat": 32,
    "laneRange": "1-10",
    "checked": true,
    "note": "序奏段已校对"
  }'

curl -X POST http://127.0.0.1:3019/tunes/$TUNE_ID/sections \
  -H 'Content-Type: application/json' \
  -d '{
    "startBeat": 33,
    "endBeat": 64,
    "laneRange": "4-18",
    "checked": false,
    "note": "主歌段待打孔"
  }'

curl -X POST http://127.0.0.1:3019/tunes/$TUNE_ID/sections \
  -H 'Content-Type: application/json' \
  -d '{
    "startBeat": 65,
    "endBeat": 96,
    "laneRange": "2-16",
    "checked": false,
    "note": "副歌段紧急"
  }'

# 3. 批量生成打孔任务（将所有未检查区间转成任务，高优先级）
GEN_RESULT=$(curl -s -X POST http://127.0.0.1:3019/punch-tasks/generate \
  -H 'Content-Type: application/json' \
  -d "{
    \"tuneId\": \"$TUNE_ID\",
    \"defaultPriority\": \"high\"
  }")
echo "生成任务结果: $GEN_RESULT"

# 4. 按状态查询所有待领取的任务
echo "===== 待领取任务 ====="
curl "http://127.0.0.1:3019/punch-tasks?status=pending"

# 5. 领取第一个任务（指定负责人）
TASK_ID=$(echo $GEN_RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])")
echo "领取任务ID: $TASK_ID"
CLAIM_RESULT=$(curl -s -X PATCH http://127.0.0.1:3019/punch-tasks/$TASK_ID/claim \
  -H 'Content-Type: application/json' \
  -d '{
    "assignee": "张三",
    "note": "今天下午完成"
  }')
echo "领取结果: $CLAIM_RESULT"

# 6. 查询张三名下的进行中任务
echo "===== 张三进行中的任务 ====="
curl "http://127.0.0.1:3019/punch-tasks?status=claimed&assignee=张三"

# 7. 完成任务并同步标记区间为已检查（推荐闭环操作）
COMPLETE_RESULT=$(curl -s -X PATCH http://127.0.0.1:3019/punch-tasks/$TASK_ID/complete \
  -H 'Content-Type: application/json' \
  -d '{
    "checkSection": true,
    "sectionNote": "打孔完成，已校验无误",
    "note": "按时完成"
  }')
echo "完成结果: $COMPLETE_RESULT"

# 8. 完成后验证：查询任务状态（应为 completed）和区间状态（应为 checked:true）
echo "===== 任务完成后状态 ====="
curl "http://127.0.0.1:3019/punch-tasks?status=completed&tuneId=$TUNE_ID"
echo "===== 区间检查状态 ====="
curl http://127.0.0.1:3019/tunes/$TUNE_ID/sections

# ---------- 其他任务操作示例 ----------

# 手动创建单个紧急任务（指定具体区间）
SECTION_ID=$(curl -s http://127.0.0.1:3019/tunes/$TUNE_ID/unchecked-sections | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['id']) if d['data'] else print('')")
if [ -n "$SECTION_ID" ]; then
  curl -X POST http://127.0.0.1:3019/punch-tasks \
    -H 'Content-Type: application/json' \
    -d "{
      \"tuneId\": \"$TUNE_ID\",
      \"sectionId\": \"$SECTION_ID\",
      \"priority\": \"urgent\",
      \"note\": \"演出前必须完成\"
    }"
fi

# 查询所有未分配的高优先级任务
echo "===== 未分配的高/紧急优先级任务 ====="
curl "http://127.0.0.1:3019/punch-tasks?onlyUnassigned=true&priority=high"
```

## 纸带校对报告完整示例：从创建问题到生成报告快照

```bash
# 1. 创建一个新曲目
NEW_TUNE=$(curl -s -X POST http://127.0.0.1:3019/tunes \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "秋日华尔兹",
    "composer": "李明",
    "templateId": "tpl_20_semitrans"
  }')
TUNE_ID=$(echo $NEW_TUNE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "曲目ID: $TUNE_ID"

# 2. 为曲目添加纸带区间（部分已检查、部分未检查）
curl -s -X POST http://127.0.0.1:3019/tunes/$TUNE_ID/sections \
  -H 'Content-Type: application/json' \
  -d '{"startBeat":1,"endBeat":32,"laneRange":"1-10","checked":true,"note":"引子段已校对"}' > /dev/null

SECTION2=$(curl -s -X POST http://127.0.0.1:3019/tunes/$TUNE_ID/sections \
  -H 'Content-Type: application/json' \
  -d '{"startBeat":33,"endBeat":64,"laneRange":"4-18","checked":false,"note":"主歌段待校对"}')
SECTION_ID2=$(echo $SECTION2 | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

SECTION3=$(curl -s -X POST http://127.0.0.1:3019/tunes/$TUNE_ID/sections \
  -H 'Content-Type: application/json' \
  -d '{"startBeat":65,"endBeat":96,"laneRange":"2-16","checked":false,"note":"副歌段待校对"}')
SECTION_ID3=$(echo $SECTION3 | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

# 3. 上报问题（漏孔）
ISSUE1=$(curl -s -X POST http://127.0.0.1:3019/issues \
  -H 'Content-Type: application/json' \
  -d "{
    \"tuneId\": \"$TUNE_ID\",
    \"sectionId\": \"$SECTION_ID2\",
    \"type\": \"漏孔\",
    \"beat\": 41,
    \"lane\": 12,
    \"description\": \"第41拍高音孔漏打\"
  }")
ISSUE_ID1=$(echo $ISSUE1 | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

# 4. 上报问题（错孔）
ISSUE2=$(curl -s -X POST http://127.0.0.1:3019/issues \
  -H 'Content-Type: application/json' \
  -d "{
    \"tuneId\": \"$TUNE_ID\",
    \"sectionId\": \"$SECTION_ID2\",
    \"type\": \"错孔\",
    \"beat\": 50,
    \"lane\": 8,
    \"description\": \"第50拍第8轨孔位偏移\"
  }")
ISSUE_ID2=$(echo $ISSUE2 | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

# 5. 上报问题（偏孔）
ISSUE3=$(curl -s -X POST http://127.0.0.1:3019/issues \
  -H 'Content-Type: application/json' \
  -d "{
    \"tuneId\": \"$TUNE_ID\",
    \"sectionId\": \"$SECTION_ID3\",
    \"type\": \"偏孔\",
    \"beat\": 72,
    \"lane\": 5,
    \"description\": \"第72拍第5轨孔偏右1mm\"
  }")
ISSUE_ID3=$(echo $ISSUE3 | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

# 6. 修复第一个问题并验证通过
curl -s -X PATCH http://127.0.0.1:3019/issues/$ISSUE_ID1/status \
  -H 'Content-Type: application/json' \
  -d '{"status":"fixed","fixDescription":"已重新打孔第41拍第12轨高音孔"}' > /dev/null
curl -s -X PATCH http://127.0.0.1:3019/issues/$ISSUE_ID1/status \
  -H 'Content-Type: application/json' \
  -d '{"status":"verified","reviewNote":"试奏确认高音已正确发声"}' > /dev/null

# 7. 查看实时校对报告（不持久化，反映当前最新数据）
echo "===== 实时校对报告 ====="
curl -s http://127.0.0.1:3019/tunes/$TUNE_ID/report | python3 -m json.tool

# 报告中应包含：
# - stripSpec: 曲目纸带规格
# - coverage: { totalSections: 3, checkedSections: 1, uncheckedSections: 2, coveragePercent: 33 }
# - uncheckedSectionDetails: 2个未检查区间
# - openIssueDetails: 2个未关闭问题（错孔+偏孔）
# - issueCountByType: { "漏孔": 1, "错孔": 1, "偏孔": 1 }
# - summary: { totalIssues: 3, openIssues: 2, closedIssues: 1 }
# - suggestedNextSteps: 建议处理顺序

# 8. 保存为历史快照（附带标签，方便后续检索）
SNAPSHOT=$(curl -s -X POST http://127.0.0.1:3019/tunes/$TUNE_ID/report/snapshot \
  -H 'Content-Type: application/json' \
  -d "{\"label\": \"修复漏孔后第一次检查点\"}")
SNAPSHOT_ID=$(echo $SNAPSHOT | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "快照ID: $SNAPSHOT_ID"

# 9. 查看该曲目的所有报告快照列表
echo "===== 快照列表 ====="
curl -s http://127.0.0.1:3019/tunes/$TUNE_ID/report/snapshots | python3 -m json.tool

# 10. 查询指定快照的完整报告内容（历史快照数据不受后续修改影响）
echo "===== 历史快照详情 ====="
curl -s http://127.0.0.1:3019/report-snapshots/$SNAPSHOT_ID | python3 -m json.tool

# 11. 继续修复剩余问题后，再次生成实时报告（数据已更新）
curl -s -X PATCH http://127.0.0.1:3019/issues/$ISSUE_ID2/status \
  -H 'Content-Type: application/json' \
  -d '{"status":"fixed","fixDescription":"已调整第50拍第8轨孔位"}' > /dev/null

echo "===== 更新后的实时报告 ====="
curl -s http://127.0.0.1:3019/tunes/$TUNE_ID/report | python3 -m json.tool

# 12. 再次保存快照（可对比两次快照差异，追踪修复进度）
curl -s -X POST http://127.0.0.1:3019/tunes/$TUNE_ID/report/snapshot \
  -H 'Content-Type: application/json' \
  -d '{"label": "错孔修复后第二次检查点"}'

# 13. 查看所有快照，按时间倒序排列
echo "===== 全部快照 ====="
curl -s http://127.0.0.1:3019/tunes/$TUNE_ID/report/snapshots | python3 -m json.tool
```

## 本地与CI验证流程

本项目零依赖（不引入Web框架、不引入数据库依赖、不引入测试框架），所有验证脚本均使用 Node.js 内置模块。所有验证过程**绝对不会写坏仓库里的 `data/db.json`**，也**不会覆盖 `data/backups/` 中的历史备份**——每个脚本都通过 `DATA_DIR` 环境变量指向独立临时目录，服务退出后自动清理。验证完成后会主动校验仓库原始数据的 SHA256 与备份目录完整性。

### 前置条件

- Node.js >= 16
- 无需 `npm install`（无任何依赖）

### 一键全量验证（本地 & CI 通用）

```bash
# 顺序执行：语法检查 → 冒烟测试 → 迁移兼容检查 → 并发事务测试 → 跨版次保护测试
npm test
# 或
npm run verify
# CI 别名
npm run ci
```

### 分步验证命令

| 命令 | 说明 | 失败退出码 | 是否触碰仓库数据 |
|------|------|-----------|----------------|
| `npm run lint` | 语法检查（`node --check` 所有 JS + JSON parse） | `1` | ❌ 只读 |
| `npm run smoke` | 临时 DATA_DIR 启动，14 项 API 冒烟测试闭环 | `1` | ❌ 临时目录隔离 |
| `npm run migrate-check` | 7 个历史版本（v0~v6）模拟迁移到当前 v7 | `1` | ❌ 临时目录隔离 |
| `npm run test:concurrent` | 并发写入隔离测试，7 项原子性验证 | `1` | ❌ 临时目录隔离 |
| `npm run test:edition` | 跨版次保护回归测试，5 项保护机制验证 | `1` | ❌ 临时目录隔离 |

### 各验证阶段说明

#### 1. 语法检查 `npm run lint`

- 对 `server.js`、`test-concurrent.js`、`test-edition-protection.js` 及 `scripts/*.js` 执行 `node --check`
- 对 `package.json`、`data/db.json`、`data/migration-log.json` 执行 JSON parse
- 仅做静态校验，不启动服务

#### 2. 冒烟测试 `npm run smoke`

- 从 `data/db.json` **复制**一份到系统临时目录（`os.tmpdir()` 下的 `zfl-smoke-XXXXXX`），设置 `DATA_DIR` 启动服务
- 随机端口（3300~4299 区间），避免与已运行服务冲突
- 覆盖 14 个 API 场景：健康检查 → 曲目/区间 CRUD → 问题状态流转 → 模板 → 版次创建/对比 → 任务生成/领取/完成 → 报告快照 → 写入队列最终一致
- 验证完毕后：
  1. 等待写入队列排空（`pendingWrites=0`）
  2. **校验仓库 `data/db.json` SHA256 未变**
  3. **校验 `data/backups/` 目录文件清单和 mtime 未变**
  4. 递归删除临时目录

#### 3. 迁移兼容检查 `npm run migrate-check`

为每个历史版本构造具有代表性的"脏数据"（含悬挂引用、非法枚举值、缺失字段等），依次启动服务自动迁移到 v7：

| 场景 | 构造数据特点 | 验证重点 |
|------|-------------|---------|
| v0 → v7 | 无 `_dataVersion` 字段、无版次、issue 用旧 `resolved` 状态 | 自动初始化版次、状态归一化、模板补齐 |
| v1 → v7 | 含悬挂 section 引用、非法 priority/status、无 stripSpecTemplates | 悬挂引用清理、枚举值归一化、模板注入 |
| v2 → v7 | 多版次结构、旧版次绑定的 issue | 跨版次 issue 引用清理 |
| v3~v5 → v7 | 不同阶段中间格式 | 增量迁移链无断点 |
| v6 → v7 | 最新前一版，含 punchTasks 完整字段 | 最新版本迁移零改动 |

每个场景迁移后：
- `/health` 返回 `dataVersion === 7`
- 磁盘 `db.json` 已写入新版号
- `/tunes`、`/strip-spec-templates` 接口正常返回
- 场景结束后校验仓库真实数据未被改动

#### 4. 并发事务测试 `npm run test:concurrent`

（沿用已有 `test-concurrent.js`，已自带临时 `DATA_DIR` 隔离）

覆盖 7 项并发安全验证：
1. 10 路并发创建区间无丢失
2. 5 路并发创建版次版本号唯一
3. 合法/非法请求并发提交时失败事务正确回滚
4. 单个写入失败后写入队列不卡死，后续写入成功
5. `setAsCurrent` 并发版次切换原子性（唯一 current）
6. 结束试奏 + 批量创建问题原子回滚
7. 任务完成 + 区间勾选 + 版次快照更新原子同步

#### 5. 跨版次保护测试 `npm run test:edition`

（沿用已有 `test-edition-protection.js`，已自带临时 `DATA_DIR` 隔离）

覆盖 5 项跨版次保护验证：
1. 领取旧版次任务默认返回 409（不带 `force`）
2. 领取旧版次任务带 `force: true` 允许
3. 完成旧版次任务默认返回 409（不带 `force`）
4. 完成旧版次任务带 `force: true` 允许
5. `checkSection` 仅同步实时 sections + 当前版次快照，旧快照不被回写

### CI 配置示例

#### GitHub Actions

```yaml
name: Verify
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: 全量验证
        run: npm run ci
```

#### GitLab CI

```yaml
image: node:20-alpine
verify:
  script:
    - npm run ci
```

### 失败排查指南

#### `npm run lint` 失败

| 现象 | 排查步骤 |
|------|---------|
| `SyntaxError: Unexpected token` | 对应文件语法错误，查看报错行号。若为近期修改，对比 `git diff` 中括号/逗号配对 |
| `Unexpected end of JSON input` | `data/db.json` 格式损坏。检查最近一次写入是否被中断（`.tmp.*` 文件残留通常是断电/杀进程所致）。可从 `data/backups/` 中恢复最近备份 |
| 文件不存在警告 | 正常现象，脚本会跳过不存在的目标文件 |

#### `npm run smoke` 失败

| 现象 | 排查步骤 |
|------|---------|
| `服务启动超时` | 1. 检查端口是否被占用（脚本打印 `PORT=XXXX node server.js`）；2. 查看日志中 `[Migration]` 段是否报错；3. `data/db.json` 迁移失败时服务不会退出而是继续运行，但若迁移抛异常可能卡主 |
| 断言失败：`/health` 非 200 | 服务启动异常，查看 `[server]` 前缀日志 |
| `写入队列未排空: pendingWrites > 0` | 有异步写入未完成，常见原因：磁盘慢、15s 内高频写入。再次运行通常可通过；若持续失败，检查 `server.js` 中 `enqueueWrite` 是否有未捕获异常 |
| `data/db.json 被修改！` | **严重**——表示隔离机制失效。检查脚本中是否遗漏了 `DATA_DIR` 传递；排查近期是否修改了 server 中硬编码 `./data/` 路径 |
| `backups/ 被覆盖` | **严重**——检查 `createBackup()` 是否在无迁移时误触发。正常情况下临时目录的 backups 写入不会进入仓库目录 |

#### `npm run migrate-check` 失败

| 现象 | 排查步骤 |
|------|---------|
| 单个场景版本号未到 v7 | 对应迁移函数（`migrate_vX_to_vY`）未正确递增 `_dataVersion`。在 `server.js` 中定位对应函数，检查末尾 `data._dataVersion = Y` 赋值 |
| 场景 v0/v1 模板数不足 5 | `initialData.stripSpecTemplates` 被改动或 v0/v1 迁移逻辑中模板注入分支缺失 |
| 悬挂引用未清理（接口 500） | 在 `migrate_v1_to_v2`、`migrate_v2_to_v3` 中加入调试日志，确认 filter 逻辑正确 |
| 服务端日志 `[Migration] Backup failed` | 临时目录权限问题，脚本使用 `os.tmpdir()`，确认系统临时目录可写 |

#### `npm run test:concurrent` 失败

| 现象 | 排查步骤 |
|------|---------|
| Test 1 区间数量缺失 | `enqueueWrite` 串行化保证不丢失数据，若失败极可能是 `transaction()` 中 snapshot 回滚逻辑把成功请求也回滚了。检查 `server.js` 中 `transaction()` 的 try/finally 顺序 |
| Test 2 版本号重复 | 版次号生成处（创建版次的 handler）未加事务锁。确认创建版次的整个计算 `max(version)+1` 到写入被同一个 `transaction()` 包裹 |
| Test 4 队列卡死：`pendingFinal !== 0` | `enqueueWrite` 的 catch 分支未正确递减 `pendingWrites`。检查 `pendingWrites = Math.max(0, pendingWrites - 1)` 是否遗漏 |
| Test 6/7 原子回滚失败 | 跨对象操作（endPlaySession / completeTask+checkSection）未在同一个 `transaction()` 中执行。确认 handler 中所有相关写操作均在同一事务内 |

#### `npm run test:edition` 失败

| 现象 | 排查步骤 |
|------|---------|
| 领取/完成旧版次任务未返回 409 | `claim`/`complete` handler 中 `taskEditionId` 与 `currentEditionId` 对比逻辑被改动。检查是否遗漏 `force` 判断分支 |
| Test 5 `checkSection` 回写旧快照 | 版次快照更新逻辑错误。正确行为：只更新 `isCurrent === true` 的版次的 `sectionsSnapshot`，历史快照只读 |

### 手动故障注入与快速复现

如验证失败，可临时注入：

```bash
# 指定固定端口复现随机端口问题
PORT=3999 node scripts/smoke-test.js

# 只跑迁移检查的单个场景（临时加注释过滤 TEST_SCENARIOS 数组即可）
```

### 数据安全承诺

所有验证脚本统一遵循以下隔离原则：

1. **绝不直接使用仓库 `data/` 作为 `DATA_DIR`**，一律 `mkdtemp` 创建临时目录再将 `db.json` 复制过去
2. 服务进程通过 `env.DATA_DIR` 显式传入，不依赖 `server.js` 的默认路径
3. 验证完成后无论成功失败均 `SIGTERM` 服务并 `rm -rf` 临时目录
4. **双重校验**：验证前对 `data/db.json` 计算 SHA256、对 `data/backups/` 做清单快照；验证后对比哈希未变、备份目录无增删改
5. 若 SHA256 校验或备份目录校验失败，即使 API 测试通过，整体仍退出非零并打印明确警告

> 违反以上原则的修改会导致 CI 失败，请在改动验证脚本后自查以上 5 点。
