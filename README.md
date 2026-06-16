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
```
