# Nuwa 项目工程与安全审查报告

**审查日期**: 2026-07-23
**项目路径**: D:/dev/projects/nuwa
**项目类型**: Next.js 16 + FastAPI 视频标注系统

---

## 一、总体评估

| 维度 | 评级 | 说明 |
|------|------|------|
| 代码质量 | ⭐⭐⭐⭐ | 结构清晰，TypeScript strict 模式，有良好的类型定义 |
| 安全性 | ⭐⭐⭐⭐ | 认证、路径遍历、SSRF 防护到位，存在少量可改进点 |
| 配置管理 | ⭐⭐⭐⭐ | .gitignore 妥善排除敏感文件，环境变量文档完整 |
| 脚本/部署 | ⭐⭐⭐ | PowerShell 脚本功能完善，缺少 CI/CD 和自动化测试 |
| 文档 | ⭐⭐⭐⭐⭐ | 中英文 README 详尽，安全说明清晰 |

**总体结论**: 项目工程质量较高，安全意识良好，无严重漏洞。存在少量中等风险点和可改进项。

---

## 二、配置文件审查

### 2.1 package.json ✅
- 版本管理合理：Next.js 16.2.9、React 19.2.4 使用固定版本，devDependencies 使用 `^` 范围
- `private: true` 防止意外发布
- scripts 定义完整，包括 `postinstall`、`setup`、`dev`、`build`、`start`
- 依赖精简：仅 4 个生产依赖（jszip、next、parquetjs、react-dom）

### 2.2 tsconfig.json ✅
- `strict: true` — 启用所有严格类型检查
- ES2017 target，支持现代浏览器
- 路径别名 `@/*` 配置正确
- 包含 `.mts` 文件支持

### 2.3 next.config.ts ✅
- 正确配置 `serverExternalPackages: ["parquetjs"]` 处理可选原生依赖
- 注释清楚说明原因

### 2.4 eslint.config.mjs ✅
- 使用 flat config（ESLint 9 标准）
- 集成 `eslint-config-next` 的核心 web vitals 和 TypeScript 规则
- 正确忽略 `.next/`、`out/`、`build/`、`next-env.d.ts`

### 2.5 .gitignore ✅
- **优秀**: 正确排除了 `/configs`（含 LLM API key）、`/data`、`/generated_data`
- 排除 `worker.env`、`.venv/`、`models/`、`__pycache__/`
- 排除所有视频文件 (`*.mp4`, `*.mov` 等) 和模型权重 (`*.safetensors`, `*.pt`, `*.pth`, `*.onnx`)
- 排除 `.claude/`、`CLAUDE.md`、`AGENTS.md`

### 2.6 postcss.config.mjs ✅
- 正确配置 Tailwind CSS 4 的 PostCSS 插件

---

## 三、脚本审查 (scripts/)

### 3.1 start-video-worker.ps1 ✅
- **端口冲突检测**: 使用 `Get-NetTCPConnection` + `netstat` 双重检查，正确拒绝重复启动
- **Python 解析器**: 通过 `video-worker-common.ps1` 的 `Resolve-NuwaWorkerPython` 统一解析
- **环境变量**: 优先使用命令行参数，其次环境变量，最后默认值 `127.0.0.1:8765`
- **开发模式**: `-Dev` 开关启用 `uvicorn --reload` 和清理 `__pycache__`
- **认证提示**: 启动时检测 HF token 状态并给出中文提示
- **安全**: 所有路径通过 Join-Path 构建
- **⚠️ 中等**: 第 33 行通过 Python 执行 `from providers.registry import ...` 的字符串拼接，但 `$WorkerDir` 来自项目内部，风险可控

### 3.2 video-worker-common.ps1 ✅
- **Import-NuwaWorkerEnv**: 正确解析 KEY=VALUE 格式，支持引号包裹、注释跳过、不覆盖已有环境变量
- **Resolve-NuwaWorkerPython**: 四级回退：
  1. `NUWA_WORKER_PYTHON` 环境变量
  2. 项目内 `.venv\Scripts\python.exe`
  3. Conda 环境名 `yolo` 的 python
  4. 系统 PATH 中的 python
- **⚠️ 中等**: 第 19 行 `Set-Item -Path "Env:$name" -Value $value` 仅在变量不存在时设置（`-not (Test-Path "Env:$name")`），但 `Test-Path "Env:VARNAME"` 在 PowerShell 中检查的是 PowerShell 驱动器，不检查 `$Env:VARNAME`

### 3.3 setup-video-worker.ps1 ✅
- Profile 参数使用 `ValidateSet` 限制为合法值
- 支持 `pip install -e .[profile]` 安装模式
- 自动创建数据子目录
- 可选的模型下载支持

### 3.4 start-all.ps1 ✅
- 使用 `Start-Job` 在后台启动 Worker
- 前台运行 `npm run dev`
- 前端退出时自动清理 Worker 进程

### 3.5 check-video-environment.ps1 ✅
- 全面环境检查：Python、CUDA、FFmpeg、端口占用、磁盘空间
- 20GB 磁盘建议阈值合理

### 3.6 setup.js / postinstall.js ✅
- `setup.js`: 创建 `data/` 和 `configs/` 运行时目录
- `postinstall.js`: 为 parquetjs 的 lzo 可选依赖创建 stub，注释说明清晰

---

## 四、认证机制审查

### 4.1 proxy.ts (全局中间件) ✅
- **时间恒定比较**: `constantTimeEqual` 使用按位异或，防止时序攻击
- **Basic Auth**: 从 `Authorization` 头提取，Base64 解码，安全比对
- **环境变量验证**: `NUWA_AUTH_USER` 和 `NUWA_AUTH_PASSWORD` 必须同时配置，否则返回 503
- **跨站变异检测**: `isCrossSiteMutation` 检查 `sec-fetch-site` 头和 Origin
- **⭐ 亮点**: 认证失败返回 `WWW-Authenticate` 头 `charset="UTF-8"`（RFC 7617）

### 4.2 admin-access.ts ✅
- **部署变更保护**: `deploymentMutationDenied` 仅允许 localhost/127.0.0.1/::1 访问
- 若配置了全局 Basic Auth 则放行（认为已有认证层）
- 清晰的中文错误消息

### 4.3 _require_admin (Python Worker) ✅
- **多层防护**: 先检查 `client.host` 是否在回环地址集合中
- **内部共享密钥**: 支持 `NUWA_WORKER_ADMIN_TOKEN` + `x-nuwa-worker-admin` 头
- **安全比较**: 使用 `secrets.compare_digest` 防止时序攻击
- **默认拒绝**: 不满足任何条件时返回 403

### 4.4 hf_auth.py (HuggingFace 认证) ✅
- **Token 保护**: `authorize_with_token` 函数接收 token 但不返回给调用方
- **环境变量检测**: 拒绝覆盖环境变量管理的 `HF_TOKEN`
- **异步模型下载**: 使用守护线程执行下载，不阻塞 API 响应
- **状态机管理**: `status` 流转受锁保护
- **错误安全**: `_safe_error` 限制错误消息长度 ≤400 字符

---

## 五、安全机制审查

### 5.1 CORS 设置 ✅
- **Worker (FastAPI)**: `allow_origins=["http://localhost:3000"]`，严格限制
- **Next.js**: 无显式 CORS 中间件（API 路由由同源 Next.js 服务），正确

### 5.2 路径遍历防护 ✅⭐⭐
- **`assertSafeIdentifier`**: 正则 `/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/` 严格限制
- **`assertSafeFileStem`**: 阻止 `..`、`.`、Windows 保留名（CON/PRN/NUL）、非法字符
- **`resolveWithin`**: 使用 `path.resolve` + `path.relative` + 前缀检查三重验证
- **`getUploadFile`**: 额外验证文件名为 `source.[A-Za-z0-9]+` 格式
- **所有 API 路由**: 统一使用 `getTaskDir`/`getUploadDir`/`getTaskPath` 进行路径构建
- **restore 端点**: 通过 `readdir` 读取目录名 → `getTaskPath(dirName)` → 自动触发 `assertSafeIdentifier`

### 5.3 上传安全 ✅
- **Content-Type 验证**: 必须为 `multipart/form-data`
- **扩展名白名单**: `.mp4, .mov, .avi, .mkv, .webm`
- **文件大小**: 限制 2GB (`MAX_FILE_SIZE`)
- **临时文件**: 先写入 `.tmp` 再 `rename` 为最终路径（原子操作）
- **SHA-256**: 上传时计算文件哈希
- **⚠️ 中等风险**: 第 51 行 `Buffer.from(await file.arrayBuffer())` 将整个文件加载到内存，2GB 文件会导致 OOM。建议改为流式写入。

### 5.4 文件服务路由 ✅
- **Range 支持**: 正确处理 `Content-Range` 请求，支持视频拖动
- **ffmpeg 帧提取**: 使用 `resolveWithin` 限制输出路径在缓存目录内
- **超时控制**: ffmpeg 调用 15 秒超时
- **失败回退**: 返回 1×1 白色 JPEG 占位图

### 5.5 SSRF 防护 ✅⭐⭐
- **`llm-url-policy.ts`**: 完整的私有 IP 地址检测
  - IPv4: 检测 0.0.0.0/8、10.0.0.0/8、127.0.0.0/8、169.254.0.0/16、172.16.0.0/12、192.168.0.0/16 等
  - IPv6: 检测非全球路由地址（非 2000::/3）
  - 嵌入式 IPv4（`::ffff:` 前缀）
- **DNS 重绑定防护**: `assertSafeLlmRequestUrl` 在请求前解析域名并重新验证 IP
- **白名单机制**: `NUWA_LLM_ALLOWED_PRIVATE_HOSTS` 环境变量支持本地 Ollama 等服务
- **URL 中凭据禁止**: 拒绝包含用户名/密码的 Base URL

### 5.6 Subprocess 安全 ✅
- **Python 端**: 所有 `subprocess.run` 使用列表参数（list），无 `shell=True`
- **TypeScript 端**: 使用 `execFile`（非 `exec`），参数通过数组传递
- **超时控制**: 所有外部进程调用都有合理超时（15-120 秒）

### 5.7 XSS 防护 ✅
- 代码库中未发现 `dangerouslySetInnerHTML`、`innerHTML` 或 `__html` 赋值

---

## 六、Token / 密钥处理审查

### 6.1 LLM API Key ✅
- **存储**: 仅存储在服务端 `configs/llm-config.json`
- **不返回客户端**: `GET /api/llm/config` 返回 `hasApiKey` 布尔值而非实际密钥
- **更新**: `POST /api/llm/config` 仅在客户端提供新值时覆盖，否则保留现有值
- **传输**: 通过 `Authorization: Bearer` 或 `x-api-key` 头传递给 LLM 提供商
- **⚠️ 信息**: `configs/llm-config.json` 当前包含 `"apiKey": "sk-083...6af9"` 实际密钥。虽然 `configs/` 在 `.gitignore` 中已排除，但建议确认此密钥未在其他地方泄露。

### 6.2 HuggingFace Token ✅
- **Python Worker 存储**: 通过 `huggingface_hub` 的 `login()` 存储到 HF 缓存
- **不返回**: `authorize_with_token` 仅返回用户名，不返回 token
- **环境变量优先**: 若 `HF_TOKEN` 环境变量已设置，拒绝 API 级别的 token 修改
- **敏感值不在日志中出现**: 错误消息限制在 400 字符且只取第一行

### 6.3 Worker Admin Token ✅
- 通过 `NUWA_WORKER_ADMIN_TOKEN` 环境变量或 `x-nuwa-worker-admin` 请求头传递
- 使用 `secrets.compare_digest` 安全比较

---

## 七、依赖版本审查

### 7.1 Node.js 依赖
| 依赖 | 版本 | 状态 |
|------|------|------|
| next | 16.2.9 (固定) | ✅ 最新 |
| react | 19.2.4 (固定) | ✅ 最新 |
| react-dom | 19.2.4 (固定) | ✅ 最新 |
| jszip | ^3.10.1 | ✅ 稳定 |
| parquetjs | ^0.11.2 | ⚠️ 半年未更新，但功能稳定 |
| typescript | ^5 | ✅ 最新 |
| tailwindcss | ^4 | ✅ 最新 |
| eslint | ^9 | ✅ 最新 |

### 7.2 Python 依赖
| 依赖 | 版本范围 | 状态 |
|------|----------|------|
| fastapi | >=0.115,<1 | ✅ |
| uvicorn | >=0.32,<1 | ✅ |
| torch | >=2.4,<3 | ✅ |
| transformers | >=4.46,<6 | ✅ |
| ultralytics | >=8.3,<9 | ✅ |
| opencv-python | >=4.10,<5 | ✅ |

- ⚠️ Python 使用兼容范围而非锁文件（README 已说明），生产部署建议使用 `pip freeze` 生成 `requirements-lock.txt`

---

## 八、API 路由安全审查

### 8.1 认证分级

| 路由 | 认证级别 | 机制 |
|------|----------|------|
| 全局（除静态文件） | Basic Auth（可选） | proxy.ts |
| `/api/video-annotation/auth/*` | admin-access + _require_admin | 双重检查 |
| `/api/video-annotation/deployment/*` | admin-access + _require_admin | 双重检查 |
| `/api/video-annotation/upload` | Basic Auth | proxy.ts |
| `/api/llm/*` | Basic Auth | proxy.ts (API key 服务端) |
| 其他 API | Basic Auth | proxy.ts |

### 8.2 缺失的安全措施 ⚠️

| 措施 | 状态 | 建议 |
|------|------|------|
| 速率限制 | ❌ 缺失 | 建议对 `/api/llm` 和 `/api/video-annotation/upload` 添加速率限制 |
| CSRF Token | ❌ 缺失 | 虽然 `isCrossSiteMutation` 已提供部分防护，建议增加 CSRF token |
| CSP 头 | ❌ 未配置 | 建议在 `next.config.ts` 中添加 Content-Security-Policy |
| 请求大小限制 | ⚠️ 部分 | 上传限制 2GB 但缓冲在内存中 |
| Helmet 安全头 | ❌ 未配置 | 建议添加 X-Frame-Options, X-Content-Type-Options 等 |

---

## 九、README 文档审查 ✅

- **中英文双语**: `README.md` (338行) + `README.zh-CN.md`
- **内容完整**: 功能列表、架构图、存储模型、快速开始、Worker 配置、API 概览、环境变量表、安全说明
- **安全说明透明**: 
  - "password-free for trusted local use"
  - "do not commit runtime configuration"
  - "prefer a secret manager and HTTPS"
- **限制声明**: 明确列出当前限制（无数据库、无多用户、无测试套件等）

---

## 十、关键发现汇总

### 🔴 高风险 - 无
未发现严重安全漏洞。

### 🟡 中等风险 (3 项)

1. **上传文件全量加载到内存**
   - 文件: `app/api/video-annotation/upload/route.ts:51`
   - `Buffer.from(await file.arrayBuffer())` 将整个文件（最大 2GB）加载到内存
   - 建议: 改用流式写入，避免 OOM

2. **LLM API Key 存储在本地文件**
   - 文件: `configs/llm-config.json`
   - 当前包含实际的 DeepSeek API Key (`sk-083...6af9`)
   - 虽然 `.gitignore` 已排除，建议确认此 key 未被提交到 git 历史或复制到其他位置
   - 建议: 生产环境改用环境变量或 Secret Manager

3. **缺少速率限制**
   - `/api/llm` 无请求频率限制，可能导致 API 费用失控
   - `/api/video-annotation/upload` 无并发上传限制
   - 建议: 添加基于 IP 或 session 的速率限制

### 🟢 低风险 / 改进建议 (5 项)

4. **lzo stub 不一致**: `scripts/postinstall.js` 的 stub（静默空函数）与 `lib/lzo-stub.js`（抛出错误）行为不同。统一为一种行为。

5. **PowerShell `Test-Path "Env:$name"` 语义**: 在 `video-worker-common.ps1:22` 中，此检查检查的是 PowerShell 驱动器而非进程环境变量，可能导致环境变量被意外覆盖。

6. **无自动化测试**: README 明确说明 "no automated test command or checked-in test suite"。建议至少添加 API 路由的集成测试。

7. **Python 依赖无锁文件**: `pyproject.toml` 使用 `>=` 范围而非精确版本。生产环境建议 `pip freeze > requirements-lock.txt`。

8. **安全响应头缺失**: 未配置 `X-Frame-Options`、`X-Content-Type-Options`、`Strict-Transport-Security` 等安全头。

---

## 十一、亮点总结 ⭐

- **认证实现专业**: 时间恒定比较、`secrets.compare_digest`、WWW-Authenticate charset 规范
- **SSRF 防护完善**: 完整覆盖 IPv4/IPv6 私有地址范围、DNS 重绑定检测、白名单机制
- **路径遍历防护层层设防**: `assertSafeIdentifier` → `assertSafeFileStem` → `resolveWithin` 三重验证
- **Secrets 不泄露设计**: API Key 不返回客户端、HF Token 不返回调用方
- **Subprocess 安全**: 全部使用数组参数，无 shell 注入风险
- **原子文件操作**: 写入 `.tmp` → `rename`，防止崩溃导致文件损坏
- **端口冲突检测**: Worker 启动前检查端口占用
- **优雅降级**: ffmpeg 帧提取失败返回占位图而非崩溃
- **文档质量极高**: 双语 README、架构图、完整环境变量表、安全说明、限制声明

---

## 十二、行动计划建议

| 优先级 | 行动 | 预估工作量 |
|--------|------|------------|
| P1 | 上传改为流式写入，避免内存 OOM | 1-2h |
| P1 | 确认 configs/llm-config.json 中 API Key 安全 | 15min |
| P2 | 添加 `/api/llm` 速率限制 | 2-3h |
| P2 | 添加安全响应头（CSP, X-Frame-Options 等） | 1h |
| P3 | 统一 lzo stub 行为 | 15min |
| P3 | 生成 Python requirements-lock.txt | 30min |
| P3 | 添加基本 API 集成测试 | 4-8h |
