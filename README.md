# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Alim-14-code/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Alim-14-code/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token protocol in a sealed DefiLlama snapshot by the implied value of its launch, each with a concrete farm plan, in a static dashboard that runs with no network. Model radar-4 fits the launch multiple to the snapshot itself: log market cap against log TVL over the snapshot's own live-token protocols (slope 0.52 — market cap grows with roughly the square root of TVL), so each protocol reads its multiple off that size curve at its own TVL, clamped 0.02..1.00. The fit is walk-forward validated against a flat median (out-of-sample log error 2.25 vs 2.60 on 2025 listings). The model weights TVL falls half again as much as rises, and lets maturity decay gently after three years without a token.

## Run it

```sh
node main.ts --input snapshot.json --output out
```

Then open `out/dashboard/index.html` in a browser. `main.ts` (Node 22, standard library only) reads the snapshot, writes the ranked board to `out/board.json`, the dashboard's data to `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref={referral_code}&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
