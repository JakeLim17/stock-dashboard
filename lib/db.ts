import "server-only";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type {
  NewsItem,
  Quote,
  AnalysisResult,
  TechIndicators,
  FlowData,
} from "./types";

// Vercel/serverless 환경에서는 파일 쓰기가 안 되거나 휘발성이므로 :memory: 로 동작.
// 로컬 개발에서는 data/stock.db 에 영구 저장.
const IS_SERVERLESS =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NEXT_RUNTIME === "edge";

function resolveDbPath(): string {
  if (IS_SERVERLESS) return ":memory:";
  const dir = path.join(process.cwd(), "data");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "stock.db");
  } catch {
    // 파일 시스템 쓰기 불가 → 메모리 DB로 fallback
    return ":memory:";
  }
}

// 모듈 1회만 초기화 (Next 핫리로드에서도 재사용)
declare global {
  var __stockDb: Database.Database | undefined;
}

function init(db: Database.Database) {
  // WAL은 파일 기반에서만 의미 있음. :memory:에서는 skip.
  if (db.name !== ":memory:") {
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
    } catch {
      /* read-only fs 등 */
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS quotes (
      ts          INTEGER NOT NULL,
      symbol      TEXT    NOT NULL,
      price       REAL    NOT NULL,
      prev_close  REAL,
      change_abs  REAL,
      change_rate REAL,
      volume      REAL,
      high        REAL,
      low         REAL,
      PRIMARY KEY (symbol, ts)
    );
    CREATE INDEX IF NOT EXISTS idx_quotes_symbol_ts ON quotes(symbol, ts DESC);

    CREATE TABLE IF NOT EXISTS flows (
      ts                INTEGER NOT NULL,
      symbol            TEXT    NOT NULL,
      foreign_net       REAL,
      institution_net   REAL,
      individual_net    REAL,
      foreign_net_5d    REAL,
      institution_net_5d REAL,
      individual_net_5d REAL,
      PRIMARY KEY (symbol, ts)
    );

    CREATE TABLE IF NOT EXISTS tech (
      ts     INTEGER NOT NULL,
      symbol TEXT    NOT NULL,
      sma5   REAL,
      sma20  REAL,
      sma60  REAL,
      rsi14  REAL,
      trend  TEXT,
      heat   REAL,
      PRIMARY KEY (symbol, ts)
    );

    CREATE TABLE IF NOT EXISTS analyses (
      ts         INTEGER NOT NULL,
      symbol     TEXT    NOT NULL,
      signal     TEXT    NOT NULL,
      heat_score REAL,
      buy_score  REAL,
      headline   TEXT,
      reasons    TEXT,
      PRIMARY KEY (symbol, ts)
    );

    CREATE TABLE IF NOT EXISTS news (
      id           TEXT PRIMARY KEY,
      ts           INTEGER NOT NULL,
      title        TEXT NOT NULL,
      link         TEXT NOT NULL,
      source       TEXT,
      symbol       TEXT,
      sentiment    TEXT,
      keywords     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_news_ts ON news(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_news_symbol ON news(symbol);
  `);

  // 기존 DB 호환 — flows 테이블에 individual_net / individual_net_5d 컬럼이 없으면 추가.
  // SQLite는 ADD COLUMN IF NOT EXISTS가 없으므로 try/catch.
  for (const col of ["individual_net", "individual_net_5d"]) {
    try {
      db.exec(`ALTER TABLE flows ADD COLUMN ${col} REAL`);
    } catch {
      /* 이미 존재하면 무시 */
    }
  }
}

export function getDb(): Database.Database {
  if (!global.__stockDb) {
    const db = new Database(resolveDbPath());
    init(db);
    global.__stockDb = db;
  }
  return global.__stockDb;
}

// ──────── 저장 헬퍼 ────────

export function saveQuote(q: Quote) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO quotes (ts, symbol, price, prev_close, change_abs, change_rate, volume, high, low)
       VALUES (@ts, @symbol, @price, @prev, @abs, @rate, @vol, @high, @low)`
    )
    .run({
      ts: q.fetchedAt,
      symbol: q.code,
      price: q.price,
      prev: q.prevClose,
      abs: q.changeAbs,
      rate: q.changeRate,
      vol: q.volume,
      high: q.high ?? null,
      low: q.low ?? null,
    });
}

export function saveFlow(symbol: string, ts: number, f: FlowData) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO flows
         (ts, symbol, foreign_net, institution_net, individual_net,
          foreign_net_5d, institution_net_5d, individual_net_5d)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ts,
      symbol,
      f.foreignNet,
      f.institutionNet,
      f.individualNet ?? null,
      f.foreignNet5d ?? null,
      f.institutionNet5d ?? null,
      f.individualNet5d ?? null
    );
}

export function saveTech(symbol: string, ts: number, t: TechIndicators) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO tech (ts, symbol, sma5, sma20, sma60, rsi14, trend, heat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ts,
      symbol,
      t.sma5 ?? null,
      t.sma20 ?? null,
      t.sma60 ?? null,
      t.rsi14 ?? null,
      t.trend ?? null,
      t.heat ?? null
    );
}

export function saveAnalysis(symbol: string, ts: number, a: AnalysisResult) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO analyses (ts, symbol, signal, heat_score, buy_score, headline, reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ts,
      symbol,
      a.signal,
      a.heatScore,
      a.buyScore,
      a.headline,
      JSON.stringify(a.reasons)
    );
}

export function saveNews(items: NewsItem[]) {
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO news (id, ts, title, link, source, symbol, sentiment, keywords)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = getDb().transaction((rows: NewsItem[]) => {
    for (const n of rows) {
      stmt.run(
        n.id,
        n.publishedAt,
        n.title,
        n.link,
        n.source ?? null,
        n.symbol ?? null,
        n.sentiment ?? null,
        JSON.stringify(n.keywords ?? [])
      );
    }
  });
  tx(items);
}

// ──────── 조회 헬퍼 ────────

export function recentQuotes(symbol: string, limit = 120): Quote[] {
  const rows = getDb()
    .prepare(
      `SELECT ts, symbol, price, prev_close as prevClose, change_abs as changeAbs,
              change_rate as changeRate, volume, high, low
       FROM quotes WHERE symbol = ? ORDER BY ts DESC LIMIT ?`
    )
    .all(symbol, limit) as Array<{
    ts: number;
    symbol: string;
    price: number;
    prevClose: number;
    changeAbs: number;
    changeRate: number;
    volume: number | null;
    high: number | null;
    low: number | null;
  }>;
  return rows.map((r) => ({
    code: r.symbol,
    name: r.symbol,
    price: r.price,
    prevClose: r.prevClose,
    changeAbs: r.changeAbs,
    changeRate: r.changeRate,
    volume: r.volume,
    high: r.high,
    low: r.low,
    fetchedAt: r.ts,
  }));
}

export function recentNews(limit = 20): NewsItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, ts, title, link, source, symbol, sentiment, keywords
       FROM news ORDER BY ts DESC LIMIT ?`
    )
    .all(limit) as Array<{
    id: string;
    ts: number;
    title: string;
    link: string;
    source: string | null;
    symbol: string | null;
    sentiment: NewsItem["sentiment"];
    keywords: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    link: r.link,
    source: r.source ?? "",
    publishedAt: r.ts,
    symbol: r.symbol,
    sentiment: r.sentiment,
    keywords: safeParseArray(r.keywords),
  }));
}

function safeParseArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
