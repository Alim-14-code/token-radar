# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Alim-14-code/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Alim-14-code/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token protocol in a sealed DefiLlama snapshot by the implied value of its launch, each with a concrete farm plan, in a static dashboard that runs with no network.

## Run it

```sh
node main.ts --input snapshot.json --output out
```

Then open `out/dashboard/index.html` in a browser. `main.ts` (Node 22, standard library only) reads the snapshot, writes the ranked board to `out/board.json`, the dashboard's data to `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref={referral_code}&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
