# Nuwa (女娲) — Intelligent Synthetic Data Platform

[中文版](README.zh-CN.md)

Nuwa is an open-source synthetic data platform powered by LLMs. Define relational schemas, configure any OpenAI/Anthropic-compatible model, and generate realistic datasets in seconds. Built with Next.js 16.

## Features

- **8 column types** — Text (LLM), Number (code), Boolean, Date, ID, Phone, City, Foreign Key
- **8 ID formats** — UUID v4/v7, Snowflake, Auto-increment, CUID2, MongoDB ObjectID, Nano ID, ULID
- **6 export formats** — JSON, CSV, Excel (XLSX), XML, SQL INSERT, Parquet
- **LLM-powered generation** — Text via direct prompts; Number/Date via LLM-generated JS code executed in sandbox
- **Foreign key resolution** — Reference data from other tables, with fallback to Parquet files
- **Per-column statistics** — Histograms, distributions, top values, uniqueness rates
- **Drag-and-drop** — Reorder tables and columns
- **Bilingual** — Chinese / English UI
- **Zero external API dependencies** — XLSX, ZIP, IDs, all hand-rolled

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 + React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Storage | localStorage + Parquet files |
| LLM | OpenAI / Anthropic compatible APIs |

## Quick Start

```bash
npm install
npm run dev
```

### 1. Configure LLM

Open `http://localhost:3000/settings` and set up your API connection. Presets for DeepSeek, OpenAI, Anthropic, and Ollama are included.

### 2. Create a project

Give it a name — this groups related tables together.

### 3. Define tables and columns

Each column has a type. Text columns need a prompt describing what to generate. Number columns take JavaScript code (or a prompt to generate code). Foreign keys reference columns in other tables.

### 4. Generate data

Pick a row count and click "Generate". Text columns call your configured LLM. Everything else runs locally.

### 5. Export

Export individual tables or use "Export All" to download an entire project at once.

## Column Types

| Type | Method |
|---|---|
| `text` | LLM generates values from a natural-language prompt |
| `number` | Sandboxed JS code execution (LLM-generated or hand-written) |
| `boolean` | Random or code-driven (returns `1`/`0`) |
| `date` | Weighted time-range distribution, LLM code, or custom JS |
| `id` | Choose from 8 ID formats |
| `phone` | Per-country phone numbers (10 countries) |
| `city` | Per-country city data (CN, US, JP, GB) |
| `foreign_key` | Samples from a referenced table's rows |

## ID Formats

`uuid4` · `uuid7` · `snowflake` · `auto_increment` · `cuid2` · `objectid` · `nanoid` · `ulid`

## Export Formats

JSON · CSV · Excel (XLSX) · XML · SQL INSERT · Parquet

## Project Structure

```
nuwa/
  app/                 # Next.js App Router pages & API routes
  services/            # Core logic (generation, export, stats, i18n, store)
  components/          # Shared React components
  scripts/setup.js     # Creates required directories on first run
  configs/             # Server-side LLM config (gitignored)
  generated_data/      # Parquet output (gitignored)
```

## License

MIT
