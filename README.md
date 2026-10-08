# VN Quant — Regime-Aware Multi-Factor Trading Platform

**Frontend-only** quant research app for Vietnam equities (HOSE / HNX / UPCOM).

Not a prediction toy. Goal: systematic opportunity search with clear invalidation, risk/reward, and backtestable rules.

```
Market Regime → Multi-factor Ranking → Setup Detection → Risk Plan → Backtest
```

## Stack

- React 19 + Vite + TypeScript
- Tailwind CSS v4 + shadcn-style UI
- React Router · TanStack Query
- IndexedDB + memory cache
- Client-side indicators / scoring / backtest
- Deploy: **Vercel** (static SPA)

**No backend. No PostgreSQL. No Redis. No hard-coded API keys.**


## Production data (vnstock on Vercel)

This project includes **Python serverless functions** under `api/`:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Health check |
| `GET /api/ohlcv?symbol=VCB&start=2024-01-01&end=2026-10-08` | Daily OHLCV |
| `GET /api/index?symbol=VNINDEX&start=...&end=...` | Index series |

Stack: `requirements.txt` → `vnstock` + `pandas`. No API key.

### Deploy

1. Push repo to GitHub
2. Import on [Vercel](https://vercel.com) (Framework: Vite)
3. Deploy — Vercel installs Python deps from `requirements.txt` and serves `api/*.py`
4. Open production URL → **Settings** → provider **VNStock (Vercel API)** → **Test Connection**
5. **T+ / Hold** → **Force Refresh**

### Limits

- Cold start can take several seconds (free tier)
- Upstream VCI/TCBS may rate-limit Vercel IPs — retry / reduce universe
- Local without running API: use **Mock**
- Not tick-by-tick realtime; daily bars after session close are the quant input


## Quick start

```bash
cd quant-trading-web
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle
```

Deploy: connect the repo to Vercel (or `vercel`). `vercel.json` already rewrites to `index.html`.

## Routes

| Path | Purpose |
|------|---------|
| `/dashboard` | Live market regime + index KPIs |
| `/tplus` | Short-term T+ scanner (cache-first) |
| `/hold` | Multi-month Hold scanner |
| `/stock/:symbol` | Chart, T+/Hold signals, full features |
| `/backtest` | Event-driven backtest + equity curve |
| `/settings` | Provider, theme, universe, cache |

## Architecture

```
UI (pages)
  → hooks / scannerService / marketDataService
    → cache (memory + IndexedDB)
      → MarketDataProvider (Mock | HTTP | iTick…)
    → Feature Engine (pure)
    → Regime Engine
    → T+ / Hold Strategy Engines
    → Risk (entry / SL / TP / R:R)
    → Backtest Engine
```

### Data providers

- **Mock** — offline development, deterministic-ish fundamentals
- **HTTP** — generic JSON adapter (configure base URL in Settings)
- **iTick** (optional) — client-side key in `sessionStorage` only

CORS is a browser constraint: use Mock, a CORS-friendly API, or a personal proxy you control.

### Cache policy

Keys: `provider:kind:symbol:timeframe:start:end`  
TTL by kind (OHLCV, fundamentals, scanner results ~30m).  
Settings → clear all / clear scanner cache.

## Quant engines

### Market regime
`BULL` · `BULL_PULLBACK` · `SIDEWAYS` · `DISTRIBUTION` · `BEAR` · `PANIC`  
Multi-factor: EMA location/slopes, ADX, vol, volume, optional breadth.

### T+ (`TPLUS_MULTI_v1`)
Horizon 3–15 sessions.  
Setups: Breakout, Pullback, Momentum, RSI divergence, VSA, Mean reversion.  
Weights: trend, setup quality, RS, volume, momentum, regime, location, liquidity.  
**Score ≠ Trade quality ≠ Confidence.** Poor R:R → WAIT/NO_TRADE.

### Hold (`HOLD_QUALITY_GROWTH_v1`)
Horizon ≥ 3 months.  
Sector-aware (Bank / Securities / RE / Manufacturing…).  
Growth · quality · balance sheet · valuation · long-term trend · catalyst risk.

### Backtest
- Signal day T → entry **T+1 open**
- SL checked before TP same bar
- Prefix-only features (no look-ahead)
- Commission, slippage, sell tax
- Risk-based size, max concurrent, TP1 partial → BE stop

## Product questions this app answers

- What regime is the market in?
- Which names outperform?
- What setup is forming and why?
- Entry zone / trigger / invalidation / SL / TP / R:R?
- Trade quality & confidence?
- Did similar setups work historically (backtest)?

## Project layout

```
src/
  app/           # router, providers
  components/    # UI, charts, layout
  config/        # universe
  data/          # providers, cache, scannerService
  hooks/
  indicators/    # pure math / technicals
  models/
  pages/
  quant/         # features, regime, strategies, scoring, risk, backtest
```

## Phases delivered

1. Foundation — Vite/React/TS/Tailwind, routes, theme, mock provider  
2. Data layer — providers, adapters, cache  
3. Indicators — EMA, RSI, MACD, VSA, Ichimoku, divergence, VP…  
4. Feature engine  
5. Market regime  
6. T+ engine  
7. Hold engine  
8. Scanners (cache-first, filter/sort)  
9. Stock detail  
10. Backtest  
11. Polish — loading/empty/error, mobile nav, error boundary, README  

## Notes / limits

- Full ~1500-symbol scan is heavy in-browser; use liquid/custom universe.
- Fundamentals quality depends on provider (Mock is illustrative).
- Optional: `npm i lightweight-charts` to replace SVG chart later.
- Prefer Web Worker for very large backtests (engine is pure and portable).

## License

Private / personal use. Not financial advice.
