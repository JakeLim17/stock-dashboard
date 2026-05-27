<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

### Overview

Single Next.js 16 app (TypeScript, Tailwind v4, SQLite via `better-sqlite3`). No Docker, no separate backend services. All data comes from Yahoo Finance and Google News RSS (free, no API keys required).

### Running the app

- **Dev server:** `npm run dev` → http://localhost:9700
- **Build:** `npm run build`
- **Type check:** `npx tsc --noEmit`
- No ESLint config is included in this project.

### Key caveats

- `better-sqlite3` is a native addon. If `npm install` fails on it, run `npm rebuild better-sqlite3`.
- The `middleware.ts` file triggers a deprecation warning ("middleware" → "proxy") on Next.js 16. This is cosmetic and does not affect functionality.
- KIS API keys are optional. Without them, foreign/institutional investor flow data uses mock data (UI still renders correctly).
- The SQLite database file (`data/stock.db`) is auto-created on first API call. No migrations needed.
- Environment variables go in `.env.local` (copy from `.env.example`). No secrets are required for basic operation.
