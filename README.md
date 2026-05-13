# Introduction

This repo contains a fully automated trade bot. It also contains scripts to research crypto markets (symbols) based on composite strategy. It uses multiple technical indicators to form a decision whether to BUY, SELL or HOLD.

## placing orders

Script `run_evaluation.py` checks the results from the technical analysis and decided to place an order or not.

To place orders: `run_evaluation.py --execute`

To dry run the evaluation: `run_evaluation.py`

> in Dry Run mode, orders are never placed.

## Repo Set up

```mermaid
flowchart LR
  subgraph LIVE["LIVE/PAPER TRADING LOOP (uur-evaluatie)"]
    A[watchlist_crypto.json] --> B[run_evaluation.py]
    B --> C["(Alpaca API)"]
    C -->|/v2/positions| B
    C -->|quotes & bars| B
    B --> D["indicators.py\nRSI/MACD/BB + signal_score"]
    B --> E["risk.py\nstop-loss/take-profit\nlimit band & position cap"]
    B --> F{Action? BUY/SELL/HOLD}
    F -->|BUY/SELL + --execute| G["trade.py\nplace_order + rule enforcement"]
    G --> C
    F -->|HOLD or dry-run| H[journal/YYYY-MM-DD.md]
    G --> H
  end

  subgraph RESEARCH["RESEARCH / VALIDATION LOOP (walk-forward)"]
    A2[watchlist_crypto.json] --> I[walkforward_evaluate.py]
    I --> J["(Alpaca Market Data API)"]
    J -->|historical bars: 1H/4H/1D| I
    I --> D2["indicators.py\nsignal_score reused"]
    I --> K["Simulated execution\nsignal at close t\nfill at open t+1"]
    K --> L["metrics.py\nSharpe/Sortino/MDD/PF"]
    L --> M[reports/*.json + *.md]
  end

  %% Shared code note
  D -. shared .- D2
  A -. shared .- A2
```

## Journal

Results of each evaluation run is stored in a journal file in the `/journal` folder
One file per day, named `YYYY-MM-DD.md`, following `_template.md`.

The bot appends to the day's file at three points:
Please note: Github actions can skip cron jobs due to backend issues. Therefore we don't schedule the workflows on the whole hour or other peak times.

- Every hour at 23 minutes past the hour, trade evaluation block (via GitHub Actions)
- Every day at 23.21 Amsterdam time - daily reflection

Crypto trades 24/7, so a file is created every calendar day.

## Git hub Actions

To fully automate the bot so it can run autonomously, run it on set schedules.
Folder `.github/workflows` contain a yaml file to run `evaluate.py` based on the Dry Run parameter. The scheduled run will use the default as set in workflow file `trade.yml`. When run manually the dry run parameter can be set to either false or true.
