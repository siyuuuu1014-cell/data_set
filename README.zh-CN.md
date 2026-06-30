# 女娲 (Nuwa) — 智能合成数据平台

[English](README.md)

女娲是一个基于大语言模型的智能合成数据平台。定义关系型数据模式，接入任意 OpenAI/Anthropic 兼容模型，几秒内生成真实感数据集。基于 Next.js 16 构建。

## 功能特性

- **8 种列类型** — 文本 (LLM)、数字 (代码)、布尔、日期、ID、电话、城市、外键
- **8 种 ID 格式** — UUID v4/v7、雪花 ID (Snowflake)、自增、CUID2、MongoDB ObjectID、Nano ID、ULID
- **6 种导出格式** — JSON、CSV、Excel (XLSX)、XML、SQL INSERT、Parquet
- **LLM 驱动生成** — 文本由 LLM 直接生成；数字/日期由 LLM 编写代码后在沙箱中执行
- **外键关联解析** — 引用其他表的数据，支持 Parquet 文件回退查询
- **逐列数据统计** — 直方图、分布、高频值、唯一率
- **拖拽排序** — 表格和列都支持拖拽重排
- **中英双语** — 界面支持中文/英文切换
- **零外部 API 依赖** — XLSX、ZIP、各类 ID，全部手写实现

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 16.2 + React 19 |
| 语言 | TypeScript |
| 样式 | Tailwind CSS v4 |
| 存储 | localStorage + Parquet 文件 |
| 大模型 | OpenAI / Anthropic 兼容 API |

## 快速开始

```bash
npm install
npm run dev
```

### 1. 配置 LLM

打开 `http://localhost:3000/settings` 配置 API 连接。内置 DeepSeek、OpenAI、Anthropic、Ollama 服务商预设。

### 2. 创建项目

输入项目名称，一个项目对应一组关联的数据表。

### 3. 定义数据表和列

每列指定类型。文本列需要提示词描述生成内容。数字列使用 JavaScript 代码（或输入描述让 LLM 生成代码）。外键列引用其他表中的列数据。

### 4. 生成数据

选择行数，点击"生成数据"。文本列调用 LLM 生成，其余类型本地执行。

### 5. 导出数据

单表导出，或使用"导出全部"一键下载整个项目。

## 列类型详解

| 类型 | 生成方式 |
|---|---|
| `text` | LLM 根据提示词生成文本 |
| `number` | 沙箱执行 JS 代码（LLM 生成或手动编写） |
| `boolean` | 随机或代码驱动（返回 `1`/`0`） |
| `date` | 加权时间分布、LLM 生成代码或自定义 JS |
| `id` | 8 种 ID 格式可选 |
| `phone` | 按国家生成电话号码（10 国） |
| `city` | 按国家生成城市数据（中、美、日、英） |
| `foreign_key` | 从引用表的行中随机采样 |

## ID 格式

`uuid4` · `uuid7` · `snowflake` · `auto_increment` · `cuid2` · `objectid` · `nanoid` · `ulid`

## 导出格式

JSON · CSV · Excel (XLSX) · XML · SQL INSERT · Parquet

## 项目结构

```
nuwa/
  app/                 # Next.js App Router 页面与 API 路由
  services/            # 核心逻辑（生成、导出、统计、国际化、状态管理）
  components/          # 共享 React 组件
  scripts/setup.js     # 首次运行时创建所需目录
  configs/             # 服务端 LLM 配置（不上传 git）
  generated_data/      # Parquet 生成数据（不上传 git）
```

## License

MIT
