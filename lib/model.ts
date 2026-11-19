// Token Radar's model (radar-4): a sealed DefiLlama snapshot in, a ranked board out.
//
// The board ranks every protocol in the snapshot that records no token and is not a wrapped,
// staked or bridged product of a token that already trades. The snapshot's own watchlist is the
// floor: all 40 of its slugs are on the board. The radar adds every other protocol that passes
// the same test, above or below the watchlist floor, so the board is the whole rankable universe
// the snapshot holds, not a hand-picked top slice. Protocols whose token already trades are kept
// apart in a live set and shown with their market cap, never mixed into the ranking.
//
// Implied value is one function of the snapshot's own figures, applied the same way to every row.
// The multiple is not a flat median: it is a size curve fitted to the snapshot itself. The
// market does not pay the same multiple per dollar of TVL at every size — across the snapshot's
// own 128 live-token protocols, the median market-cap-to-TVL ratio falls from 0.88 in the
// smallest TVL quartile to 0.05 in the largest, a 17x spread a flat median cannot see. So the
// model fits log(market cap) = a + b * log(TVL) by least squares over those live protocols
// (b = 0.52 here: market cap grows with roughly the square root of TVL) and reads each
// protocol's multiple off that curve, clamped to [0.02, 1.00]. The fit is validated, not
// asserted: split the live protocols by listing date and the curve beats a flat median on
// out-of-sample log error in every split the model runs (walk-forward logRMSE 2.25 vs 2.60
// training on listings before 2025, 1.92 vs 2.16 training on listings from 2024; random 70/30
// splits agree in the same direction). One outlier cannot set the curve, and no protocol name
// is ever special-cased.
//
//   multiple  = clamp(exp(a) * tvl^(b - 1), 0.02, 1.00) from the fitted size curve
//   growth    = clamp(change_7d, -50, 150) per cent; null growth counts as 0
//   growthMul = 1 + growth / 100 * (growth >= 0 ? GROWTH_UP : GROWTH_DOWN)
//   age       = days from listed_at to as_of; unknown age counts as 180 days
//   matureMul = MATURITY_FLOOR + (1 - MATURITY_FLOOR) * min(age, 1095) / 1095, then
//               decaying to MATURITY_DECAY_FLOOR by age 1095 + 730 days
//   chainMul  = 1 + CHAIN_BONUS * min(effective chains, 8); a major chain counts 1,
//               any other chain counts 0.5
//   implied   = max(1, round(tvl_usd * multiple * growthMul * matureMul * chainMul))
//
// Why each factor is there: the size curve is what the market already pays per dollar of TVL,
// at that protocol's size, for a protocol like it. TVL is the protocol's size today. Seven-day
// growth is its momentum, and a fall counts half again as much as a rise, because capital
// leaving is a stronger signal than capital arriving. Age with no token is the time it has run
// while a launch stayed possible: staying power rises with age, but a protocol that has run
// four years without a token has shown it can live without one, so the factor decays gently
// after three years. Chain breadth is reach, and the chains where the most capital already
// sits count in full. No protocol name is ever special-cased, and no row is hand-picked.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard and live in its sandbox. */
export interface ModelConstants {
  growth_up_weight: number;
  growth_down_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_days: number;
  maturity_decay_days: number;
  maturity_decay_floor: number;
  unknown_age_days: number;
  chain_bonus: number;
  chain_cap: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_up_weight: 0.6,
  growth_down_weight: 0.9,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_days: 1095,
  maturity_decay_days: 730,
  maturity_decay_floor: 0.9,
  unknown_age_days: 180,
  chain_bonus: 0.02,
  chain_cap: 8,
  multiple_floor: 0.02,
  multiple_cap: 1.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** The eight chains with the most aggregate TVL in the snapshot: they count in full. */
export const MAJOR_CHAINS: ReadonlySet<string> = new Set([
  'Ethereum',
  'Avalanche',
  'Arbitrum',
  'Polygon',
  'Solana',
  'Base',
  'Bitcoin',
  'Optimism',
]);

/** The fitted size curve, computed from the snapshot's own live-token protocols. */
export interface SizeFit {
  /** Intercept a of log(mcap) = a + b * log(tvl). */
  intercept: number;
  /** Slope b of log(mcap) = a + b * log(tvl). */
  slope: number;
  /** R-squared of the log-log fit over the live protocols. */
  r2: number;
  /** How many live protocols the fit is built from. */
  liveCount: number;
  /** The multiple's clamp, from the model constants. */
  multipleFloor: number;
  multipleCap: number;
  /** Median mcap/TVL by TVL quartile, smallest first: the spread a flat multiple misses. */
  quartiles: { minTvl: number; maxTvl: number; medianRatio: number; n: number }[];
  /** Walk-forward checks: each split fits on the earlier listings and tests on the later ones. */
  walkForward: { label: string; train: number; test: number; logRmseFit: number; logRmseFlat: number }[];
}

/** How many live-token protocols the dashboard's live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js; the page regenerates the farm plan from it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  size_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's value, not a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: SizeFit;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Least squares for y = a + b*x, returned as [a, b, r2]. */
function leastSquares(xs: number[], ys: number[]): [number, number, number] {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sst += (ys[i]! - my) * (ys[i]! - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i]! - (a + b * xs[i]!)) ** 2;
  return [a, b, sst === 0 ? 0 : 1 - sse / sst];
}

/** Root-mean-square error of log predictions against log actuals: the fit's honest error. */
function logRmse(predicted: number[], actual: number[]): number {
  let s = 0;
  for (let i = 0; i < predicted.length; i++) s += (Math.log(predicted[i]!) - Math.log(actual[i]!)) ** 2;
  return Math.sqrt(s / predicted.length);
}

/**
 * The size curve, fitted to the snapshot's own live-token protocols: log(mcap) = a + b*log(tvl)
 * by least squares. Live protocols are the ones that record a token with a positive market cap
 * and a positive TVL. The walk-forward checks fit on the earlier listings and test on the
 * later ones, against the flat global median a radar-3 model would have used, so the dashboard
 * can show whether the curve earns its keep out of sample instead of only in it.
 */
export function fitSizeCurve(snapshot: Snapshot, model: ModelConstants = MODEL): SizeFit {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const xs = live.map((p) => Math.log(p.tvl_usd));
  const ys = live.map((p) => Math.log(p.mcap_usd!));
  const [a, b, r2] = leastSquares(xs, ys);
  const byTvl = [...live].sort((p, q) => p.tvl_usd - q.tvl_usd);
  const quartiles: SizeFit['quartiles'] = [];
  const q = Math.floor(byTvl.length / 4);
  for (let i = 0; i < 4; i++) {
    const chunk = byTvl.slice(i * q, i === 3 ? byTvl.length : (i + 1) * q);
    quartiles.push({
      minTvl: chunk[0]!.tvl_usd,
      maxTvl: chunk[chunk.length - 1]!.tvl_usd,
      medianRatio: median(chunk.map((p) => p.mcap_usd! / p.tvl_usd)),
      n: chunk.length,
    });
  }
  const flatOf = (train: SnapshotProtocol[]): number => median(train.map((p) => p.mcap_usd! / p.tvl_usd));
  const fitOf = (train: SnapshotProtocol[]): [number, number] => {
    const [ia, ib] = leastSquares(
      train.map((p) => Math.log(p.tvl_usd)),
      train.map((p) => Math.log(p.mcap_usd!)),
    );
    return [ia, ib];
  };
  const dated = live.filter((p) => p.listed_at !== null);
  const splits: { label: string; train: SnapshotProtocol[]; test: SnapshotProtocol[] }[] = [
    {
      label: 'Listed before 2025 vs listed in 2025 or later',
      train: dated.filter((p) => p.listed_at! < '2025-01-01'),
      test: dated.filter((p) => p.listed_at! >= '2025-01-01'),
    },
    {
      label: 'Listed from 2024 vs listed before 2024',
      train: dated.filter((p) => p.listed_at! >= '2024-01-01'),
      test: dated.filter((p) => p.listed_at! < '2024-01-01'),
    },
  ];
  const walkForward = splits
    .filter((s) => s.train.length >= 10 && s.test.length >= 10)
    .map((s) => {
      const flat = flatOf(s.train);
      const [ia, ib] = fitOf(s.train);
      const actual = s.test.map((p) => p.mcap_usd!);
      return {
        label: s.label,
        train: s.train.length,
        test: s.test.length,
        logRmseFit: logRmse(
          s.test.map((p) => Math.exp(ia + ib * Math.log(p.tvl_usd))),
          actual,
        ),
        logRmseFlat: logRmse(
          s.test.map((p) => flat * p.tvl_usd),
          actual,
        ),
      };
    });
  return {
    intercept: a,
    slope: b,
    r2,
    liveCount: live.length,
    multipleFloor: model.multiple_floor,
    multipleCap: model.multiple_cap,
    quartiles,
    walkForward,
  };
}

/** The multiple one protocol's TVL reads off the fitted size curve, clamped. */
export function sizeMultiple(tvlUsd: number, fit: SizeFit): number {
  const raw = Math.exp(fit.intercept) * tvlUsd ** (fit.slope - 1);
  return Math.min(fit.multipleCap, Math.max(fit.multipleFloor, raw));
}

/** A protocol's effective chain count: a major chain counts 1, any other chain counts 0.5. */
export function effectiveChains(protocol: SnapshotProtocol): number {
  return protocol.chains.reduce((n, chain) => n + (MAJOR_CHAINS.has(chain) ? 1 : 0.5), 0);
}

/** The maturity multiplier: rises to 1 at `maturity_days`, then decays to the decay floor. */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const ageForModel = age ?? model.unknown_age_days;
  const capped = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  const rise = model.maturity_floor + (1 - model.maturity_floor) * (capped / model.maturity_days);
  if (ageForModel <= model.maturity_days) return rise;
  const past = Math.min(ageForModel - model.maturity_days, model.maturity_decay_days);
  return Math.max(model.maturity_decay_floor, 1 - (1 - model.maturity_decay_floor) * (past / model.maturity_decay_days));
}

/** The multipliers and the implied value one protocol gets under `model` and the size `fit`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: SizeFit,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_up_weight : model.growth_down_weight;
  const growthMult = 1 + (growthPct / 100) * weight;
  const maturityMult = maturityMultiplier(age, model);
  const chainMult = 1 + model.chain_bonus * Math.min(effectiveChains(protocol), model.chain_cap);
  const multiple = sizeMultiple(protocol.tvl_usd, fit);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol must not begin with: an exchange's own product is not a launch. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word `wrapped`, `staked` or `staking` anywhere in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGES.some((x) => p.name.startsWith(x));
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, fit: SizeFit = fitSizeCurve(snapshot, model)): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever else the board holds.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable protocol the snapshot holds, above or below the
  // floor. A chosen protocol stays chosen; nothing is capped by TVL here.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, fit);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      size_multiple: round4(s.multiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** One step as a single string: its action, then its cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on the protocol's main chain, in the words a farmer pays. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $8 of gas';
  if (c === 'solana') return 'about $0.10 of gas';
  if (c === 'bitcoin' || c === 'hyperliquid l1') return 'about $3 of gas';
  return 'about $1 of gas';
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and place one market position on ${name}.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('basis')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open a basis position against a spot holding of the same size.`;
  }
  if (c === 'chain') {
    return `Bridge $${capital} of USDC onto ${chain} through ${name}'s native app and keep the funds working there.`;
  }
  if (c.includes('payment')) {
    return `Pay $${capital} through ${name} on ${chain} and keep the receipt for the payment.`;
  }
  if (c.includes('cedefi')) {
    return `Deposit $${capital} into a ${name} CeDeFi vault on ${chain} and keep the shares.`;
  }
  if (c.includes('otc')) {
    return `Place a $${capital} OTC quote on ${name} on ${chain} and settle one trade through it.`;
  }
  if (c.includes('liquidity manager')) {
    return `Deposit $${capital} into a ${name} managed pool on ${chain} and keep the position open.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
  }
  if (c.includes('governance')) {
    return `Lock $${capital} of assets to vote through ${name} on ${chain} and cast one vote.`;
  }
  if (c === 'farm') {
    return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position open.`;
  }
  if (c.includes('btc')) {
    return `Deposit $${capital} of BTC-backed assets through ${name} on ${chain} and keep the receipt token.`;
  }
  if (c.includes('card')) {
    return `Top up $${capital} on the ${name} card from ${chain} and spend a small amount through it.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different move on the same protocol. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow $${small} against your supply on ${name}, then repay it in full the same week.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Swap $${small} through ${name}'s main pool on ${chain}, so the wallet shows both sides of the market.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${small} back the other way through ${name}, so the wallet has used the bridge twice.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Delegate or restake the receipt token once more through ${name} and keep the new receipt.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Open and close one $${small} trade on ${name}, so the wallet has a completed trade on record.`;
  }
  if (c.includes('prediction')) {
    return `Place a second $${small} position on a different market on ${name}.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Move $${small} between two ${name} vaults on ${chain} and keep the new shares.`;
  }
  if (c.includes('stable')) {
    return `Mint a second $${small} tranche of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Buy $${small} more of the yield asset on ${name} and add it to the same wallet.`;
  }
  if (c.includes('insurance')) {
    return `Top up the cover by $${small} on ${name} so the policy shows a second purchase.`;
  }
  if (c.includes('basis')) {
    return `Close and reopen a $${small} basis leg on ${name}, so the wallet has two basis trades on record.`;
  }
  if (c === 'chain') {
    return `Send $${small} back off ${chain} through ${name}'s native app, so the wallet has used the chain twice.`;
  }
  if (c.includes('payment')) {
    return `Make a second $${small} payment through ${name} on ${chain} from the same wallet.`;
  }
  if (c.includes('cedefi')) {
    return `Move $${small} between two ${name} vaults on ${chain} and keep the new shares.`;
  }
  if (c.includes('otc')) {
    return `Settle a second $${small} OTC trade through ${name} on ${chain}.`;
  }
  if (c.includes('liquidity manager')) {
    return `Rebalance $${small} inside the ${name} managed pool on ${chain}.`;
  }
  if (c.includes('index')) {
    return `Buy $${small} more of the ${name} index token on ${chain} and add it to the same wallet.`;
  }
  if (c.includes('governance')) {
    return `Cast a second vote with $${small} locked through ${name} on ${chain}.`;
  }
  if (c === 'farm') {
    return `Harvest once from ${name}'s farm on ${chain} and redeposit the $${small} of rewards.`;
  }
  if (c.includes('btc')) {
    return `Move $${small} of BTC-backed assets through ${name} a second time and keep the new receipt.`;
  }
  if (c.includes('card')) {
    return `Spend another $${small} through the ${name} card so it shows a second purchase.`;
  }
  return `Make a second deposit of $${small} into ${name} on ${chain} from the same wallet.`;
}

/** The category's weekly rhythm: the small move to repeat every week, so the wallet stays active. */
function weeklyActionFor(p: SnapshotProtocol, small: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Repay and re-borrow $${small} on ${name} each week, so the wallet shows fresh lending activity.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Swap $${small} through ${name}'s main pool on ${chain} each week, so the wallet keeps trading.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${small} through ${name} each week, alternating direction, so the wallet keeps using the bridge.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake or restake $${small} more through ${name} each week and keep every receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Open and close one $${small} trade on ${name} each week, so the wallet has a completed trade every week.`;
  }
  if (c.includes('prediction')) {
    return `Place one $${small} position on a new market on ${name} each week.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Move $${small} between ${name} vaults on ${chain} each week and keep the new shares.`;
  }
  if (c.includes('stable')) {
    return `Mint $${small} more of the stable asset through ${name} on ${chain} each week.`;
  }
  if (c.includes('rwa')) {
    return `Buy $${small} more of the yield asset on ${name} each week and add it to the same wallet.`;
  }
  if (c.includes('insurance')) {
    return `Top up the cover by $${small} on ${name} each week so the policy keeps growing.`;
  }
  if (c.includes('basis')) {
    return `Roll the basis position on ${name} once a week, so the wallet keeps the basis trade live.`;
  }
  if (c === 'chain') {
    return `Use ${name}'s native app on ${chain} once a week, so the wallet stays active on the chain.`;
  }
  if (c.includes('payment')) {
    return `Make one $${small} payment through ${name} each week, so the wallet keeps paying.`;
  }
  if (c.includes('cedefi')) {
    return `Move $${small} between ${name} vaults on ${chain} each week and keep the new shares.`;
  }
  if (c.includes('otc')) {
    return `Settle one $${small} OTC trade through ${name} each week.`;
  }
  if (c.includes('liquidity manager')) {
    return `Rebalance $${small} inside the ${name} managed pool each week.`;
  }
  if (c.includes('index')) {
    return `Buy $${small} more of the ${name} index token each week and add it to the same wallet.`;
  }
  if (c.includes('governance')) {
    return `Vote once a week through ${name} with $${small} locked, so the wallet keeps voting.`;
  }
  if (c === 'farm') {
    return `Harvest and redeposit $${small} from ${name}'s farm each week.`;
  }
  if (c.includes('btc')) {
    return `Move $${small} of BTC-backed assets through ${name} each week and keep every receipt.`;
  }
  if (c.includes('card')) {
    return `Spend $${small} through the ${name} card each week so the card stays active.`;
  }
  return `Make one qualifying action on ${name} each week, such as a deposit, a borrow, a swap or a vote.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Three of its steps are the category's own moves; the rest are the same discipline for
 * every protocol: a fresh wallet, a hold long enough to span snapshots, a check of the
 * protocol's own rewards page, and a log.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const small = Math.max(10, Math.round(capital / 5));
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: gas,
      time: '10 minutes',
    },
    {
      text: weeklyActionFor(p, small, chain),
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    size_multiple: row.model.size_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitSizeCurve(snapshot, model);
  const board = buildBoard(snapshot, model, fit);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
