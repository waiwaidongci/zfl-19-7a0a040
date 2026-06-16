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
- `PATCH /sections/:id/check`

### 问题管理
- `GET /issues?tuneId=&status=`
- `POST /issues`
- `PATCH /issues/:id/status`

### 纸带规格模板
- `GET /strip-spec-templates?scale=`（模板列表，可选按音阶筛选）
- `POST /strip-spec-templates`（创建新模板）

### 打孔任务队列
- `GET /punch-tasks?tuneId=&status=&priority=&assignee=&onlyUnassigned=`（查询任务，支持多条件筛选，结果按优先级+创建时间排序）
- `POST /punch-tasks/generate`（从未检查区间批量生成待处理任务，支持指定曲目和默认优先级）
- `POST /punch-tasks`（手动创建单个任务）
- `PATCH /punch-tasks/:id/claim`（领取任务，指定负责人）
- `PATCH /punch-tasks/:id/complete`（完成任务，可选 `checkSection: true` 同步标记区间为已检查）

**任务状态说明**：`pending`（待领取）→ `claimed`（已领取/进行中）→ `completed`（已完成）

**优先级**：`low`（低）、`medium`（中，默认）、`high`（高）、`urgent`（紧急）

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
