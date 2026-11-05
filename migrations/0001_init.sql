-- Built for D1 Free: WITHOUT ROWID tables with composite PKs and no secondary indexes,
-- since every index counts as another row written.

CREATE TABLE sites (
  site_tag   TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  host       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) WITHOUT ROWID;

-- Hourly totals (UTC ISO hour, e.g. 2026-11-04T13:00:00Z). Kept for HOURLY_RETENTION_DAYS.
CREATE TABLE rum_hourly (
  site_tag  TEXT NOT NULL,
  hour      TEXT NOT NULL,
  pageviews INTEGER NOT NULL,
  visits    INTEGER NOT NULL,
  PRIMARY KEY (site_tag, hour)
) WITHOUT ROWID;

-- Daily totals (local day, YYYY-MM-DD). Kept forever.
CREATE TABLE rum_daily (
  site_tag  TEXT NOT NULL,
  day       TEXT NOT NULL,
  pageviews INTEGER NOT NULL,
  visits    INTEGER NOT NULL,
  PRIMARY KEY (site_tag, day)
) WITHOUT ROWID;

-- Daily top-N per dimension. dim: path | ref | country | browser | os | device | host
CREATE TABLE rum_daily_dim (
  site_tag  TEXT NOT NULL,
  dim       TEXT NOT NULL,
  day       TEXT NOT NULL,
  value     TEXT NOT NULL,
  pageviews INTEGER NOT NULL,
  visits    INTEGER NOT NULL,
  PRIMARY KEY (site_tag, dim, day, value)
) WITHOUT ROWID;

-- Daily Web Vitals: p75 (ms; CLS unitless) plus good/poor/total counts.
CREATE TABLE rum_daily_vitals (
  site_tag   TEXT NOT NULL,
  day        TEXT NOT NULL,
  lcp_p75 REAL, inp_p75 REAL, cls_p75 REAL, fcp_p75 REAL, ttfb_p75 REAL,
  lcp_good INTEGER, lcp_poor INTEGER, lcp_total INTEGER,
  inp_good INTEGER, inp_poor INTEGER, inp_total INTEGER,
  cls_good INTEGER, cls_poor INTEGER, cls_total INTEGER,
  fcp_good INTEGER, fcp_poor INTEGER, fcp_total INTEGER,
  ttfb_good INTEGER, ttfb_poor INTEGER, ttfb_total INTEGER,
  PRIMARY KEY (site_tag, day)
) WITHOUT ROWID;

-- Collector runs (job + period), used to spot gaps.
CREATE TABLE collector_runs (
  job    TEXT NOT NULL,
  period TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  ran_at TEXT NOT NULL,
  PRIMARY KEY (job, period)
) WITHOUT ROWID;

-- Counters (e.g. writes:2026-11-04 = rows written that UTC day).
CREATE TABLE counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
) WITHOUT ROWID;
