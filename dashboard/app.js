// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan, and a model sandbox that recomputes the board live. No
// network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });
  var BASE_MODEL = DATA.model;
  var state = {
    q: '', category: 'all', chain: 'all', tab: 'pre-token', growth: 'all',
    sort: 'implied', dir: -1, selected: null, model: null
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. The sandbox calls it with changed constants; the board keeps the submitted ones.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (1 - model.maturity_floor) * (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days);
    var chainMult = 1 + model.chain_bonus * Math.min((row.chains || []).length, model.chain_cap);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * chainMult));
  }
  function multipliersOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    return {
      growth: 1 + (growth / 100) * model.growth_weight,
      maturity: model.maturity_floor + (1 - model.maturity_floor) * (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days),
      chain: 1 + model.chain_bonus * Math.min((row.chains || []).length, model.chain_cap)
    };
  }
  function activeModel() { return state.model || BASE_MODEL; }
  function sandboxOn() { return state.model !== null; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return 'about $8 of gas';
    if (c === 'solana') return 'about $0.10 of gas';
    if (c === 'bitcoin' || c === 'hyperliquid l1') return 'about $3 of gas';
    return 'about $1 of gas';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + small + ' against your supply on ' + name + ', then repay it in full the same week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + small + ' through ' + name + "'s main pool on " + chain + ', so the wallet shows both sides of the market.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + small + ' back the other way through ' + name + ', so the wallet has used the bridge twice.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Delegate or restake the receipt token once more through ' + name + ' and keep the new receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open and close one $' + small + ' trade on ' + name + ', so the wallet has a completed trade on record.';
    if (c.indexOf('prediction') >= 0) return 'Place a second $' + small + ' position on a different market on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Move $' + small + ' between two ' + name + ' vaults on ' + chain + ' and keep the new shares.';
    if (c.indexOf('stable') >= 0) return 'Mint a second $' + small + ' tranche of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Buy $' + small + ' more of the yield asset on ' + name + ' and add it to the same wallet.';
    if (c.indexOf('insurance') >= 0) return 'Top up the cover by $' + small + ' on ' + name + ' so the policy shows a second purchase.';
    return 'Make a second deposit of $' + small + ' into ' + name + ' on ' + chain + ' from the same wallet.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: gas, time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('growth')) state.growth = params.get('growth');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.growth !== 'all') params.set('growth', state.growth);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Rows with the sandbox's implied value attached when the sandbox is on; otherwise the
  // board's own value. Display rank follows the active value, board rank stays on the row.
  function scoredRows() {
    var model = activeModel();
    return DATA.rows.map(function (r) {
      var v = sandboxOn() ? impliedOf(r, model) : r.implied_value_usd;
      return { row: r, value: v };
    });
  }
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return scoredRows().filter(function (s) {
      var r = s.row;
      if (state.tab === 'watchlist' && !WATCH[r.slug]) return false;
      if (state.tab === 'early' && WATCH[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.growth === 'growing' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (state.growth === 'fast' && !(r.change_7d !== null && r.change_7d >= 10)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var ra = a.row, rb = b.row;
      var av, bv;
      if (key === 'name') { av = ra.name.toLowerCase(); bv = rb.name.toLowerCase(); }
      else if (key === 'tvl') { av = ra.tvl_usd; bv = rb.tvl_usd; }
      else if (key === 'growth') { av = ra.change_7d === null ? -Infinity : ra.change_7d; bv = rb.change_7d === null ? -Infinity : rb.change_7d; }
      else if (key === 'age') { av = ra.age_days === null ? Infinity : ra.age_days; bv = rb.age_days === null ? Infinity : rb.age_days; }
      else { av = a.value; bv = b.value; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return ra.slug < rb.slug ? -1 : ra.slug > rb.slug ? 1 : 0;
    });
  }
  // The display rank of a row under the active model: 1..n by active value.
  function displayRanks(list) {
    var byValue = list.slice().sort(function (a, b) {
      return b.value - a.value || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0);
    });
    var rankOf = {};
    byValue.forEach(function (s, i) { rankOf[s.row.slug] = i + 1; });
    return rankOf;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ',
          el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ',
          el('b', { text: String(DATA.early_size) }),
          ' more pre-token protocols, above and below that floor, so the board is the whole rankable universe the snapshot holds. Implied value is a model, not a promise: it says what a launch would be worth if the protocol kept running as it is.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows beyond the watchlist' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function statsStrip() {
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    var sorted = DATA.rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var top = DATA.rows[0];
    var growing = DATA.rows.filter(function (r) { return r.change_7d !== null && r.change_7d > 0; }).length;
    return el('section', { class: 'strip' },
      el('div', { class: 'stat' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) }), el('small', { text: 'across ' + DATA.board_size + ' pre-token rows' })),
      el('div', { class: 'stat' }, el('span', { text: 'Rank 1' }), el('b', { text: top ? top.name : 'n/a' }), el('small', { text: top ? fmtUsd(top.implied_value_usd) + ' implied' : '' })),
      el('div', { class: 'stat' }, el('span', { text: 'Median implied value' }), el('b', { text: fmtUsd(median) }), el('small', { text: 'half the board sits above this' })),
      el('div', { class: 'stat' }, el('span', { text: 'Growing this week' }), el('b', { text: growing + ' / ' + DATA.board_size }), el('small', { text: 'rows with a positive 7-day change' }))
    );
  }

  function tabButton(label, tab) {
    return el('button', {
      type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label,
      onclick: function () { state.tab = tab; writeHash(); render(); }
    });
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var growthSelect = el('select', { id: 'growth', 'aria-label': 'Filter by growth' },
      el('option', { value: 'all', text: 'Any growth' }),
      el('option', { value: 'growing', text: 'Growing (7d > 0%)', selected: state.growth === 'growing' ? 'selected' : null }),
      el('option', { value: 'fast', text: 'Fast (7d >= +10%)', selected: state.growth === 'fast' ? 'selected' : null })
    );
    growthSelect.addEventListener('change', function () { state.growth = growthSelect.value; writeHash(); render(); });
    var shown = state.tab === 'live' ? DATA.live.length + ' live-token protocols' : visibleRows().length + ' rows shown';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'growth', text: 'Growth' }), growthSelect),
      el('div', { class: 'field' }, el('span', { text: 'Board' }),
        el('div', { class: 'tabs' }, tabButton('Pre-token', 'pre-token'), tabButton('Watchlist', 'watchlist'), tabButton('Early', 'early'), tabButton('Live token', 'live'))),
      el('span', { class: 'count', text: shown + (sandboxOn() ? ' · sandbox model on' : '') })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.growth = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, s) { return Math.max(m, s.value); }, 1);
    var ranks = displayRanks(scoredRows());
    var tbody = el('tbody');
    list.forEach(function (s) {
      var r = s.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(ranks[r.slug]) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((s.value / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(s.value) })
        )),
        el('td', null,
          WATCH[r.slug]
            ? el('span', { class: 'badge', text: 'watchlist' })
            : el('span', { class: 'badge early', text: 'early' })
        )
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = BASE_MODEL;
    var panel = el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. TVL is the protocol\u2019s size today, seven-day growth is its momentum, age with no token is how long a launch has stayed possible, and chain breadth is how many chains it reaches.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + (1 - ' + m.maturity_floor + ') x min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ') x (1 + ' + m.chain_bonus + ' x min(chains, ' + m.chain_cap + ')) )'
      ),
      el('p', { text: 'Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days, and a missing seven-day change counts as 0. The early radar is every pre-token protocol the snapshot holds that is not a wrapped, staked or bridged product, and the live-token protocols are set aside with their market caps shown.' })
    );
    panel.appendChild(sandbox(m));
    return panel;
  }

  // The model sandbox: four sliders that recompute every row's implied value and re-rank the
  // board in the page. It changes this page only; board.json keeps the submitted model.
  function sandbox(m) {
    var wrap = el('div', { class: 'sandbox' });
    var sliders = [
      { key: 'base_multiple', label: 'Base multiple', min: 0.05, max: 0.6, step: 0.01, fmt: function (v) { return v.toFixed(2); } },
      { key: 'growth_weight', label: 'Growth weight', min: 0, max: 1, step: 0.05, fmt: function (v) { return v.toFixed(2); } },
      { key: 'maturity_floor', label: 'Maturity floor', min: 0.3, max: 0.8, step: 0.05, fmt: function (v) { return v.toFixed(2); } },
      { key: 'chain_bonus', label: 'Chain bonus', min: 0, max: 0.05, step: 0.005, fmt: function (v) { return v.toFixed(3); } }
    ];
    sliders.forEach(function (s) {
      var out = el('output', { text: s.fmt(state.model ? state.model[s.key] : m[s.key]) });
      var input = el('input', { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step), value: String(state.model ? state.model[s.key] : m[s.key]), 'aria-label': s.label });
      input.addEventListener('input', function () {
        if (!state.model) state.model = Object.assign({}, m);
        state.model[s.key] = parseFloat(input.value);
        out.textContent = s.fmt(state.model[s.key]);
        render();
      });
      wrap.appendChild(el('div', { class: 'slider' }, el('label', { text: s.label }), input, out));
    });
    var note = el('div', { class: 'sandbox-note' },
      el('p', { class: 'sub', text: 'Try the model: move a slider and the board re-ranks at once. The sandbox changes this page only; board.json and the submitted ranking keep the model above.' }),
      el('button', { class: 'button', type: 'button', text: 'Reset model', onclick: function () { state.model = null; render(); } })
    );
    var box = el('div', null);
    box.appendChild(el('h3', { text: 'Model sandbox' }));
    box.appendChild(wrap);
    box.appendChild(note);
    return box;
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var model = activeModel();
    var mults = multipliersOf(row, model);
    var value = impliedOf(row, model);
    var steps = farmSteps(row);
    var meter = function (label, v, max) {
      return el('div', null, el('span', { text: label }),
        el('span', { class: 'meter' },
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((v / max) * 100)) + '%' })),
          el('b', { class: 'num', text: 'x' + v.toFixed(2) })
        ));
    };
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (sandboxOn() ? ' · sandbox model' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        meter('Growth multiplier', mults.growth, 1.9),
        meter('Maturity multiplier', mults.maturity, 1),
        meter('Chain multiplier', mults.chain, 1.16),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(value) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, BASE_MODEL)) + (impliedOf(row, BASE_MODEL) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(el('p', { class: 'warn', text: 'Records no token is not the same as has no token: DefiLlama\u2019s record may miss one. Never pay to claim an airdrop, and never connect a wallet to a link that is not the protocol\u2019s own page.' }));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', null, el('b', { text: 'Method. ' }), 'Snapshot ', DATA.as_of, ' from ', DATA.source, '. The watchlist is the floor, never the ceiling: a protocol below it is no worse a subject. Implied value is this entry\u2019s own claim, never make.fun\u2019s.'),
      el('p', null, el('b', { text: 'Built with ' }), 'superbot.gg, a free AI agent client that keeps the sessions this entry was built in.'),
      el('p', { text: 'Token Radar · model ' + DATA.model_version + ' · no network: every byte on this page ships with it.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(statsStrip());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'live' ? liveTable() : boardTable());
    if (state.tab !== 'live') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
