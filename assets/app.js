/* Vitalis Fantasy — page renderers. Vanilla JS, no build step.
   Every page is a shell; this script fetches dist/data/*.json and renders. */
(() => {
  'use strict';
  const ROOT = window.SITE_ROOT || './';
  const PAGE = window.PAGE || document.body.dataset.page;
  const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
  const POS_ORDER = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };
  const STATUS = { a: 'Available', d: 'Doubtful', i: 'Injured', s: 'Suspended', u: 'Unavailable', n: 'Not in squad' };
  const CHIP_LABEL = { wildcard: 'Wildcard', bench_boost: 'Bench Boost', triple_captain: 'Triple Captain', free_hit: 'Free Hit', bboost: 'Bench Boost', '3xc': 'Triple Captain', freehit: 'Free Hit', manager: 'Assistant Manager' };
  const PHOTO = code => `https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png`;

  // ---------- tiny DOM + format helpers ----------
  const cache = {};
  async function load(name) {
    if (!cache[name]) {
      cache[name] = fetch(`${ROOT}data/${name}.json`, { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
        return r.json();
      });
    }
    return cache[name];
  }
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const money = v => (v == null ? '–' : `£${(v / 10).toFixed(1)}m`);
  const pct = p => (p == null ? '–' : `${Math.round(p * 100)}%`);
  const num = (v, d = 0) => (v == null || v === '' ? '–' : Number(v).toFixed(d));
  const fmtDate = iso => {
    if (!iso) return '–';
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(iso));
  };
  const fmtStamp = iso => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(iso)) : '–');
  const countdown = iso => {
    if (!iso) return '';
    let s = Math.floor((new Date(iso) - Date.now()) / 1000);
    if (s <= 0) return 'deadline passed';
    const d = Math.floor(s / 86400); s -= d * 86400;
    const hr = Math.floor(s / 3600); s -= hr * 3600;
    const m = Math.floor(s / 60);
    return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`;
  };
  const fdr = (d, label) => h('span', { class: `fdr fdr-${d || 'blank'}` }, label ?? (d ?? '–'));
  const bar = (p, text) => h('span', { class: 'bar-cell' }, h('span', { class: 'bar', style: { width: `${Math.round((p || 0) * 60)}px` } }), text ?? pct(p));
  const qs = () => new URLSearchParams(location.search);

  // ---------- shared data context ----------
  const ctx = {};
  async function context() {
    if (ctx.ready) return ctx;
    const [meta, players, teams] = await Promise.all([load('meta'), load('players'), load('teams')]);
    ctx.meta = meta;
    ctx.players = new Map(players.map(p => [p.id, p]));
    ctx.playerList = players;
    ctx.teams = new Map(teams.map(t => [t.id, t]));
    ctx.teamList = teams;
    ctx.ready = true;
    return ctx;
  }
  const player = id => ctx.players.get(Number(id)) || { id, web_name: `#${id}`, team: 0, element_type: 0, now_cost: null };
  const team = id => ctx.teams.get(Number(id)) || { id, name: '?', short_name: '???' };
  const short = id => team(id).short_name;
  const posOf = p => POS[p.element_type] || '?';

  function renderChrome(meta) {
    const fresh = document.getElementById('freshness');
    if (fresh && meta) {
      fresh.innerHTML = `Data as of <strong>${fmtStamp(meta.as_of)}</strong>` + (meta.next_gw ? `<br>GW${meta.next_gw} deadline ${fmtDate(meta.next_deadline)} · ${countdown(meta.next_deadline)}` : '');
    }
    const built = document.getElementById('built');
    if (built && meta) built.textContent = `Built ${fmtStamp(meta.built_at)} · model ${meta.model?.version || ''}`;
  }

  // ---------- components ----------
  function dataTable({ columns, rows, sort, dir = 'desc', pageSize = 50, rowClass, onRow, empty = 'Nothing to show.' }) {
    let sortKey = sort, sortDir = dir, limit = pageSize;
    const wrap = h('div', { class: 'table-wrap' });
    const sorted = () => {
      if (!sortKey) return rows;
      const col = columns.find(c => c.key === sortKey);
      const val = r => (col && col.sort ? col.sort(r) : r[sortKey]);
      return [...rows].sort((a, b) => {
        const x = val(a), y = val(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        return sortDir === 'asc' ? c : -c;
      });
    };
    const draw = () => {
      wrap.innerHTML = '';
      const thead = h('thead', null, h('tr', null, columns.map(c => h('th', {
        class: [c.num ? 'num' : '', c.sortable !== false ? 'sortable' : '', sortKey === c.key ? `sorted ${sortDir}` : ''].join(' ').trim(),
        title: c.title || null,
        onclick: c.sortable === false ? null : () => {
          if (sortKey === c.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          else { sortKey = c.key; sortDir = c.dir || 'desc'; }
          draw();
        },
      }, c.label))));
      const all = sorted();
      const shown = all.slice(0, limit);
      const tbody = h('tbody', null, shown.length ? shown.map(r => h('tr', {
        class: [rowClass ? rowClass(r) : '', onRow ? 'clickable' : ''].join(' ').trim() || null,
        onclick: onRow ? () => onRow(r) : null,
      }, columns.map(c => h('td', { class: c.num ? 'num' : null }, c.render ? c.render(r) : r[c.key] ?? '–')))) : h('tr', null, h('td', { colspan: columns.length, class: 'muted' }, empty)));
      wrap.append(h('table', { class: 'data' }, thead, tbody));
      if (all.length > pageSize) {
        wrap.append(h('div', { class: 'table-foot' }, h('span', null, `Showing ${shown.length} of ${all.length}`),
          limit < all.length ? h('button', { class: 'pill', onclick: () => { limit += pageSize * 2; draw(); } }, 'Show more') : h('button', { class: 'pill', onclick: () => { limit = pageSize; draw(); } }, 'Show fewer')));
      }
    };
    draw();
    return wrap;
  }

  function tile(label, value, sub) {
    return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
  }
  function section(title, ...children) {
    return h('section', { class: 'section' }, typeof title === 'string' ? h('h2', null, title) : title, ...children);
  }
  function statusBadge(p) {
    if (!p || p.status === 'a') return null;
    const chance = p.chance_of_playing_next_round;
    return h('span', { class: `badge ${p.status === 'd' ? 'amber' : 'red'}`, title: p.news || '' }, STATUS[p.status] || p.status, chance != null ? ` ${chance}%` : '');
  }

  /** picks: [{id, start:boolean, order, captain, vice, multiplier}] */
  function pitch(picks, { points, showPrice = true } = {}) {
    const starters = picks.filter(p => p.start).sort((a, b) => POS_ORDER[posOf(player(a.id))] - POS_ORDER[posOf(player(b.id))] || a.order - b.order);
    const bench = picks.filter(p => !p.start).sort((a, b) => a.order - b.order);
    const rows = { GKP: [], DEF: [], MID: [], FWD: [] };
    starters.forEach(p => (rows[posOf(player(p.id))] || rows.MID).push(p));
    const shirt = p => {
      const pl = player(p.id);
      const pts = points ? points[String(p.id)] : undefined;
      const mult = p.multiplier ?? (p.captain ? 2 : 1);
      return h('div', {
        class: ['shirt', pl.status && pl.status !== 'a' ? `flag flag-${pl.status}` : ''].join(' ').trim(),
        title: `${pl.first_name || ''} ${pl.second_name || pl.web_name} · ${team(pl.team).name}${pl.news ? ' · ' + pl.news : ''}`,
        onclick: () => openPlayer(pl.id),
      },
        p.captain ? h('span', { class: 'cap' }, mult === 3 ? 'TC' : 'C') : p.vice ? h('span', { class: 'cap vc' }, 'V') : null,
        h('div', { class: 'name' }, pl.web_name),
        h('div', { class: 'club' }, `${short(pl.team)} · ${posOf(pl)}`),
        pts != null ? h('div', { class: 'pts' }, `${pts * (p.start ? mult : 1)}`, mult > 1 && p.start ? h('span', { class: 'sub' }, ` (${pts}×${mult})`) : null)
          : showPrice ? h('div', { class: 'sub' }, money(pl.now_cost)) : null,
      );
    };
    return h('div', { class: 'pitch' },
      ['GKP', 'DEF', 'MID', 'FWD'].map(pos => h('div', { class: 'row' }, rows[pos].map(shirt))),
      bench.length ? [h('div', { class: 'bench-label' }, 'Bench'), h('div', { class: 'row' }, bench.map(shirt))] : null,
    );
  }

  function openPlayer(id) {
    const p = player(id);
    const t = team(p.team);
    const close = () => { backdrop.remove(); drawer.remove(); };
    const backdrop = h('div', { class: 'drawer-backdrop', onclick: close });
    const group = (title, keys) => {
      const items = keys.filter(k => p[k] !== undefined && p[k] !== null && p[k] !== '').map(k => h('div', null, h('span', null, k.replaceAll('_', ' ')), h('span', null, String(p[k]))));
      return items.length ? [h('h3', null, title), h('div', { class: 'kv' }, items)] : null;
    };
    const known = new Set();
    const groups = [
      ['Availability', ['status', 'news', 'news_added', 'chance_of_playing_this_round', 'chance_of_playing_next_round']],
      ['Price & ownership', ['now_cost', 'cost_change_start', 'cost_change_event', 'selected_by_percent', 'transfers_in_event', 'transfers_out_event', 'transfers_in', 'transfers_out', 'value_form', 'value_season']],
      ['Form & points', ['total_points', 'event_points', 'form', 'points_per_game', 'ep_this', 'ep_next', 'bonus', 'bps', 'dreamteam_count']],
      ['Season stats', ['minutes', 'starts', 'goals_scored', 'assists', 'clean_sheets', 'goals_conceded', 'own_goals', 'penalties_saved', 'penalties_missed', 'yellow_cards', 'red_cards', 'saves', 'clearances_blocks_interceptions', 'recoveries', 'tackles', 'defensive_contribution']],
      ['Expected', ['expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded', 'expected_goals_per_90', 'expected_assists_per_90', 'expected_goal_involvements_per_90', 'expected_goals_conceded_per_90', 'goals_conceded_per_90', 'saves_per_90', 'starts_per_90', 'clean_sheets_per_90', 'defensive_contribution_per_90']],
      ['ICT', ['influence', 'creativity', 'threat', 'ict_index', 'influence_rank', 'creativity_rank', 'threat_rank', 'ict_index_rank']],
      ['Set pieces', ['penalties_order', 'penalties_text', 'direct_freekicks_order', 'direct_freekicks_text', 'corners_and_indirect_freekicks_order', 'corners_and_indirect_freekicks_text']],
      ['Ranks', ['now_cost_rank', 'now_cost_rank_type', 'form_rank', 'form_rank_type', 'points_per_game_rank', 'points_per_game_rank_type', 'selected_rank', 'selected_rank_type']],
    ];
    groups.forEach(([, keys]) => keys.forEach(k => known.add(k)));
    const rest = Object.keys(p).filter(k => !known.has(k));
    const drawer = h('div', { class: 'drawer', role: 'dialog' },
      h('button', { class: 'close', onclick: close, 'aria-label': 'Close' }, '×'),
      h('div', { class: 'head' },
        p.code ? h('img', { src: PHOTO(p.code), alt: '', onerror: e => e.target.remove() }) : null,
        h('div', null, h('h2', null, `${p.first_name || ''} ${p.second_name || p.web_name}`.trim()),
          h('div', null, h('span', { class: 'badge navy' }, posOf(p)), ' ', h('span', { class: 'badge' }, t.name), ' ', h('strong', null, money(p.now_cost)), ' ', statusBadge(p)),
          p.news ? h('p', { class: 'small muted', style: { marginTop: '6px' } }, p.news) : null)),
      groups.map(([title, keys]) => group(title, keys)),
      group('Other fields', rest),
      h('details', null, h('summary', null, 'Raw API record'), h('pre', { class: 'raw' }, JSON.stringify(p, null, 2))),
    );
    document.body.append(backdrop, drawer);
  }

  const pageHead = (title, sub, right) => h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), right || null);
  const playerCell = (p, extra) => h('span', null, h('a', { href: '#', onclick: e => { e.preventDefault(); openPlayer(p.id); } }, p.web_name), ' ', statusBadge(p), extra ? h('span', { class: 'sub' }, extra) : null);

  // ---------- pages ----------
  async function renderHub(app) {
    const meta = await load('meta');
    const league = await load('league').catch(() => null);
    app.append(
      h('div', { class: 'hero' }, h('h1', null, 'Vitalis Fantasy'), h('p', null, 'Home for the office fantasy games. Football is live: one real team, thirteen AI shadow managers, and the numbers behind every pick.')),
      h('div', { class: 'grid cols-3' },
        h('a', { class: 'card game-card', href: `${ROOT}football/` }, h('div', { class: 'icon' }, '⚽'), h('h2', null, 'Football'),
          h('p', { class: 'muted' }, `Fantasy Premier League ${meta.season || ''}. ${league ? league.n_teams + ' shadow teams' : 'Shadow League'} plus ${meta.real_team?.name || 'the real team'}.`),
          meta.next_gw ? h('p', null, h('strong', null, `GW${meta.next_gw} deadline `), fmtDate(meta.next_deadline), h('span', { class: 'muted' }, ` · in ${countdown(meta.next_deadline)}`)) : null,
          h('span', { class: 'more' }, 'Open the football hub →')),
        h('div', { class: 'card game-card soon' }, h('div', { class: 'icon' }, '🏉'), h('h2', null, 'Next game'), h('p', { class: 'muted' }, 'Office prediction games will move here as they launch.')),
        h('div', { class: 'card game-card soon' }, h('div', { class: 'icon' }, '🏆'), h('h2', null, 'Sweepstakes'), h('p', { class: 'muted' }, 'Coming soon.')),
      ),
    );
  }

  async function renderOverview(app) {
    await context();
    const [meta, league, my, probs, ticker] = await Promise.all([load('meta'), load('league'), load('my_team'), load('probabilities'), load('ticker')]);
    app.append(pageHead('Football', `Fantasy Premier League ${meta.season || ''} · ${league ? league.n_teams : 0} shadow teams and ${meta.real_team?.name || 'the real team'}`));
    if (meta.next_gw) app.append(h('div', { class: 'deadline' }, h('div', null, h('div', { class: 'muted' }, `Gameweek ${meta.next_gw} deadline`), h('div', { class: 'big' }, fmtDate(meta.next_deadline))), h('div', null, h('div', { class: 'muted' }, 'Time left'), h('div', { class: 'big' }, countdown(meta.next_deadline))), h('div', null, h('div', { class: 'muted' }, 'Data as of'), h('div', null, fmtStamp(meta.as_of)))));
    const cards = h('div', { class: 'grid cols-2' });
    // my team
    const myCard = h('div', { class: 'card' }, h('h2', null, meta.real_team?.name || 'My team'));
    if (my && my.summary) {
      const s = my.summary;
      myCard.append(h('div', { class: 'tiles' }, tile('Overall', s.summary_overall_points, `rank ${(s.summary_overall_rank || 0).toLocaleString('en-GB')}`), tile(`GW${s.current_event}`, s.summary_event_points ?? '–'), tile('Value', money(s.last_deadline_value), `bank ${money(s.last_deadline_bank)}`)));
    } else {
      myCard.append(h('p', { class: 'muted' }, 'Not linked yet. Add the FPL entry id to data/league/real_team.json and run the daily ingestion.'));
    }
    myCard.append(h('a', { class: 'more', href: `${ROOT}football/my-team/` }, 'My Team →'));
    cards.append(myCard);
    // league
    const lg = h('div', { class: 'card' }, h('h2', null, 'Shadow League'));
    if (league) {
      lg.append(dataTable({ columns: [
        { key: 'rank', label: '#', num: true, sortable: false },
        { key: 'display_name', label: 'Manager', sortable: false, render: r => h('a', { href: `${ROOT}football/league/?m=${r.manager_id}` }, r.display_name) },
        { key: 'archetype', label: 'Type', sortable: false, render: r => h('span', { class: `badge ${r.archetype === 'judgement-driven' ? 'amber' : ''}` }, r.archetype === 'judgement-driven' ? 'judgement' : 'data') },
        { key: 'total_points', label: 'Pts', num: true, sortable: false },
        { key: 'team_value', label: 'Value', num: true, sortable: false, render: r => money(r.team_value) },
      ], rows: league.table.slice(0, 6), pageSize: 6 }));
      if (league.captain_votes.length) lg.append(h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Captain consensus GW${league.next_gw}: `, league.captain_votes.slice(0, 3).map((v, i) => [i ? ', ' : '', h('strong', null, player(v.id).web_name), ` ×${v.count}`])));
    } else lg.append(h('p', { class: 'muted' }, 'No league ledger yet.'));
    lg.append(h('a', { class: 'more', href: `${ROOT}football/league/` }, 'Full table and squads →'));
    cards.append(lg);
    app.append(cards);

    const three = h('div', { class: 'grid cols-3', style: { marginTop: '16px' } });
    const goals = probs.players.filter(p => p.expected_minutes >= 45).slice(0, 8);
    three.append(h('div', { class: 'card' }, h('h3', null, `Most likely to score · GW${probs.gw}`), dataTable({ columns: [
      { key: 'web_name', label: 'Player', sortable: false, render: r => playerCell(player(r.id), `${short(r.team)} · ${r.position}`) },
      { key: 'p_goal', label: 'P(goal)', num: true, sortable: false, render: r => bar(r.p_goal) },
    ], rows: goals, pageSize: 8 }), h('a', { class: 'more', href: `${ROOT}football/stats/#goals` }, 'All players →')));
    three.append(h('div', { class: 'card' }, h('h3', null, `Clean sheet odds · GW${probs.gw}`), dataTable({ columns: [
      { key: 'team', label: 'Team', sortable: false, render: r => `${short(r.team)} ${r.home ? 'v' : '@'} ${short(r.opponent)}` },
      { key: 'p_clean_sheet', label: 'P(CS)', num: true, sortable: false, render: r => bar(r.p_clean_sheet) },
    ], rows: probs.teams.slice(0, 8), pageSize: 8 }), h('a', { class: 'more', href: `${ROOT}football/stats/#clean-sheets` }, 'All fixtures →')));
    if (ticker) three.append(h('div', { class: 'card' }, h('h3', null, `Easiest runs · GW${ticker.from_gw}–${ticker.gws[ticker.gws.length - 1]}`), dataTable({ columns: [
      { key: 'team', label: 'Team', sortable: false, render: r => team(r.team).name },
      { key: 'gws', label: 'Next', sortable: false, render: r => h('span', { class: 'pill-row' }, r.gws.slice(0, 4).map(cell => cell.length ? cell.map(f => fdr(f.difficulty, `${short(f.opponent)}${f.home ? '' : ' (a)'}`)) : fdr(null, '–'))) },
      { key: 'avg_difficulty', label: 'Avg', num: true, sortable: false, render: r => num(r.avg_difficulty, 2) },
    ], rows: ticker.teams.slice(0, 8), pageSize: 8 }), h('a', { class: 'more', href: `${ROOT}football/stats/#ticker` }, 'Full ticker →')));
    app.append(three);
  }

  async function renderMyTeam(app) {
    await context();
    const [meta, my, gwPoints, league] = await Promise.all([load('meta'), load('my_team'), load('gw_points'), load('league').catch(() => null)]);
    const name = meta.real_team?.name || 'My team';
    if (!my || !my.summary) {
      app.append(pageHead(name, 'The one real team.'),
        h('div', { class: 'notice warn' }, h('strong', null, 'Not linked yet. '), 'Put the team’s FPL entry id (the number in the URL at fantasy.premierleague.com/entry/<id>/…) into ', h('code', null, 'data/league/real_team.json'), ', run ', h('code', null, 'uv run python -m ingestion.run daily'), ' and rebuild. Only public read-only endpoints are used; the site never logs in.'));
      if (league?.captain_votes?.length) app.append(section(`What the shadow league is doing for GW${league.next_gw}`, h('p', null, 'Captain consensus: ', league.captain_votes.slice(0, 4).map((v, i) => [i ? ', ' : '', h('strong', null, player(v.id).web_name), ` ×${v.count}`]))));
      return;
    }
    const s = my.summary;
    app.append(pageHead(s.name || name, `${s.player_first_name || ''} ${s.player_last_name || ''} · entry ${my.entry_id} · as of ${fmtStamp(my.as_of)}`));
    app.append(h('div', { class: 'tiles' },
      tile('Overall points', s.summary_overall_points), tile('Overall rank', (s.summary_overall_rank || 0).toLocaleString('en-GB')),
      tile(`GW${s.current_event} points`, s.summary_event_points ?? '–', s.summary_event_rank ? `GW rank ${s.summary_event_rank.toLocaleString('en-GB')}` : null),
      tile('Team value', money(s.last_deadline_value), `bank ${money(s.last_deadline_bank)}`), tile('Transfers made', s.last_deadline_total_transfers ?? '–')));

    const gws = Object.keys(my.picks || {}).map(Number).sort((a, b) => a - b);
    if (gws.length) {
      let gw = gws[gws.length - 1];
      const holder = h('div');
      const drawPicks = () => {
        const data = my.picks[String(gw)];
        const picks = data.picks.map(p => ({ id: p.element, start: p.position <= 11, order: p.position, captain: p.is_captain, vice: p.is_vice_captain, multiplier: p.multiplier }));
        const eh = data.entry_history || {};
        holder.innerHTML = '';
        holder.append(
          h('div', { class: 'controls' }, h('span', { class: 'pill-row' }, gws.map(g => h('button', { class: `pill ${g === gw ? 'active' : ''}`, onclick: () => { gw = g; drawPicks(); } }, `GW${g}`))),
            data.active_chip ? h('span', { class: 'badge navy' }, CHIP_LABEL[data.active_chip] || data.active_chip) : null,
            h('span', { class: 'muted small' }, `${eh.points ?? '–'} pts · ${eh.points_on_bench ?? 0} on bench · ${eh.event_transfers ?? 0} transfers${eh.event_transfers_cost ? ` (-${eh.event_transfers_cost})` : ''}`)),
          pitch(picks, { points: gwPoints[String(gw)] }),
          data.automatic_subs?.length ? h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Auto-subs: ', data.automatic_subs.map((a, i) => [i ? '; ' : '', `${player(a.element_out).web_name} → ${player(a.element_in).web_name}`])) : null,
        );
      };
      drawPicks();
      app.append(section('Squad', holder));
    }
    if (my.history?.current?.length) {
      app.append(section('Season so far', dataTable({ columns: [
        { key: 'event', label: 'GW', num: true, dir: 'asc' },
        { key: 'points', label: 'Pts', num: true },
        { key: 'points_on_bench', label: 'Bench', num: true },
        { key: 'event_transfers', label: 'Transfers', num: true, render: r => `${r.event_transfers}${r.event_transfers_cost ? ` (-${r.event_transfers_cost})` : ''}` },
        { key: 'rank', label: 'GW rank', num: true, render: r => (r.rank || 0).toLocaleString('en-GB') },
        { key: 'total_points', label: 'Total', num: true },
        { key: 'overall_rank', label: 'Overall rank', num: true, render: r => (r.overall_rank || 0).toLocaleString('en-GB') },
        { key: 'value', label: 'Value', num: true, render: r => money(r.value) },
        { key: 'bank', label: 'Bank', num: true, render: r => money(r.bank) },
      ], rows: my.history.current, sort: 'event', dir: 'asc' })));
      const chips = my.history.chips || [];
      app.append(section('Chips', chips.length ? h('div', { class: 'pill-row' }, chips.map(c => h('span', { class: 'badge navy' }, `${CHIP_LABEL[c.name] || c.name} · GW${c.event}`))) : h('p', { class: 'muted' }, 'None played yet.')));
    }
    if (my.transfers?.length) {
      app.append(section('Transfers', dataTable({ columns: [
        { key: 'event', label: 'GW', num: true },
        { key: 'element_out', label: 'Out', render: r => `${player(r.element_out).web_name} (${money(r.element_out_cost)})` },
        { key: 'element_in', label: 'In', render: r => `${player(r.element_in).web_name} (${money(r.element_in_cost)})` },
        { key: 'time', label: 'When', render: r => fmtStamp(r.time) },
      ], rows: my.transfers, sort: 'time' })));
    }
    if (league?.captain_votes?.length) app.append(section(`Shadow league consensus for GW${league.next_gw}`, h('p', null, 'Captains: ', league.captain_votes.slice(0, 4).map((v, i) => [i ? ', ' : '', h('strong', null, player(v.id).web_name), ` ×${v.count}`])), h('a', { href: `${ROOT}football/league/` }, 'See every manager’s decision →')));
  }

  async function renderLeague(app) {
    await context();
    const [league, gwPoints] = await Promise.all([load('league'), load('gw_points')]);
    if (!league) { app.append(pageHead('Shadow League'), h('p', { class: 'muted' }, 'No league ledger yet.')); return; }
    app.append(pageHead('Shadow League', `${league.season} · ${league.n_teams} AI assistant managers, each running one strategy charter under full FPL rules since GW${league.start_gw}.`));
    let selected = qs().get('m') || league.table[0].manager_id;
    const detail = h('div');
    const tableEl = dataTable({ columns: [
      { key: 'rank', label: '#', num: true, dir: 'asc' },
      { key: 'display_name', label: 'Manager', dir: 'asc' },
      { key: 'archetype', label: 'Type', render: r => h('span', { class: `badge ${r.archetype === 'judgement-driven' ? 'amber' : ''}` }, r.archetype === 'judgement-driven' ? 'judgement' : 'data') },
      { key: 'total_points', label: 'Pts', num: true },
      { key: 'last_gw_points', label: 'Last GW', num: true },
      { key: 'gws_played', label: 'GWs', num: true },
      { key: 'team_value', label: 'Value', num: true, render: r => money(r.team_value) },
      { key: 'bank', label: 'Bank', num: true, render: r => money(r.bank) },
      { key: 'free_transfers', label: 'FTs', num: true },
      { key: 'chips_played', label: 'Chips', num: true },
      { key: 'locked_gw', label: 'Locked', render: r => (r.locked_gw ? h('span', { class: 'badge' }, `GW${r.locked_gw}`) : h('span', { class: 'muted' }, '–')) },
    ], rows: league.table, sort: 'rank', dir: 'asc', pageSize: 20, rowClass: r => (r.manager_id === selected ? 'highlight' : ''), onRow: r => { selected = r.manager_id; history.replaceState(null, '', `?m=${r.manager_id}`); drawDetail(); tableEl.querySelectorAll('tr').forEach(tr => tr.classList.remove('highlight')); } });
    app.append(section('Table', tableEl));

    const drawDetail = () => {
      const t = league.teams[selected];
      if (!t) return;
      detail.innerHTML = '';
      const locked = t.locked;
      const last = t.history[t.history.length - 1];
      let picks;
      if (locked) picks = [...locked.decision.starters.map((id, i) => ({ id, start: true, order: i, captain: id === locked.decision.captain, vice: id === locked.decision.vice_captain })), ...locked.decision.bench.map((id, i) => ({ id, start: false, order: i }))];
      else if (last) picks = [...last.final_xi.map((id, i) => ({ id, start: true, order: i, captain: id === last.effective_captain, vice: id === last.vice_captain })), ...t.squad.map(p => p.id).filter(id => !last.final_xi.includes(id)).map((id, i) => ({ id, start: false, order: i }))];
      else picks = t.squad.map((p, i) => ({ id: p.id, start: true, order: i }));
      const chips = Object.entries(t.chips || {});
      detail.append(
        h('div', { class: 'page-head' }, h('div', null, h('h2', null, t.display_name), h('p', null, h('span', { class: `badge ${t.archetype === 'judgement-driven' ? 'amber' : ''}` }, t.archetype), ' ', h('span', { class: 'badge grey' }, t.kind === 'charter' ? 'charter manager (LLM proposes, code disposes)' : 'coded manager (deterministic)'), t.charter?.version ? h('span', { class: 'muted small' }, ` · charter v${t.charter.version}`) : null)), h('div', null, h('span', { class: 'badge navy' }, `#${t.rank} · ${t.total_points} pts`))),
        h('div', { class: 'grid cols-2' },
          h('div', { class: 'card wash' }, h('h3', null, 'Philosophy'), h('p', null, t.charter?.philosophy || t.draft_rationale || '—'), t.charter?.objective ? [h('h3', null, 'Objective'), h('p', null, t.charter.objective)] : null),
          h('div', { class: 'card' }, h('div', { class: 'tiles' }, tile('Value', money(t.team_value)), tile('Bank', money(t.bank)), tile('Free transfers', t.free_transfers), tile('Chips used', chips.length, chips.map(([k, gw]) => `${CHIP_LABEL[k.split(':')[0]] || k} GW${gw}`).join(', ') || 'none')),
            locked ? h('div', { style: { marginTop: '14px' } }, h('h3', null, `Locked for GW${locked.gw}`, ' ', h('span', { class: 'muted small' }, fmtStamp(locked.as_of))),
              h('p', null, h('strong', null, 'Transfers: '), locked.sells.length ? locked.sells.map(([out, sell], i) => { const [inn, buy] = locked.buys[i] || []; return [i ? '; ' : '', `${player(out).web_name} (${money(sell)}) → ${inn != null ? player(inn).web_name : '?'} (${money(buy)})`]; }) : 'none', locked.hit ? h('span', { class: 'badge red' }, ` -${locked.hit}`) : null),
              h('p', null, h('strong', null, 'Captain: '), player(locked.decision.captain).web_name, ' ', h('span', { class: 'muted' }, `(vice ${player(locked.decision.vice_captain).web_name})`), ' · ', h('strong', null, 'Chip: '), locked.decision.chip ? CHIP_LABEL[locked.decision.chip] : 'none'),
              locked.rationale ? h('details', { open: true }, h('summary', null, 'Rationale'), h('p', { class: 'small' }, locked.rationale)) : h('p', { class: 'muted small' }, 'Coded strategy: no free-text rationale.'),
              locked.bounced?.length ? h('p', { class: 'small' }, h('span', { class: 'badge amber' }, 'bounced'), ' ', locked.bounced.join(' · ')) : null) : h('p', { class: 'muted' }, 'No decision locked for the next gameweek yet.'))),
        section(locked ? `Squad as locked for GW${locked.gw}` : 'Squad', pitch(picks, { points: locked && gwPoints[String(locked.gw)] ? gwPoints[String(locked.gw)] : undefined })),
        section('Holdings', dataTable({ columns: [
          { key: 'name', label: 'Player', dir: 'asc', sort: r => player(r.id).web_name, render: r => playerCell(player(r.id)) },
          { key: 'pos', label: 'Pos', sort: r => POS_ORDER[posOf(player(r.id))], render: r => posOf(player(r.id)) },
          { key: 'club', label: 'Club', sort: r => short(player(r.id).team), render: r => short(player(r.id).team) },
          { key: 'bought', label: 'Bought', num: true, render: r => money(r.bought) },
          { key: 'now', label: 'Now', num: true, render: r => money(r.now) },
          { key: 'sell', label: 'Sell', num: true, render: r => money(r.sell) },
          { key: 'pts', label: 'Season pts', num: true, sort: r => player(r.id).total_points, render: r => player(r.id).total_points },
          { key: 'own', label: 'Owned by', num: true, sort: r => (league.shared_picks.find(s => s.id === r.id) || {}).count, render: r => `${(league.shared_picks.find(s => s.id === r.id) || {}).count || 0}/${league.n_teams}` },
        ], rows: t.squad, sort: 'pos', dir: 'asc', pageSize: 15 })),
        section('Gameweek history', dataTable({ columns: [
          { key: 'gw', label: 'GW', num: true, dir: 'asc' },
          { key: 'points', label: 'Pts', num: true },
          { key: 'hit', label: 'Hit', num: true, render: r => (r.hit ? `-${r.hit}` : '0') },
          { key: 'net', label: 'Net', num: true },
          { key: 'captain', label: 'Captain', render: r => `${player(r.captain).web_name}${r.effective_captain !== r.captain ? ` → ${player(r.effective_captain).web_name}` : ''}` },
          { key: 'chip', label: 'Chip', render: r => (r.chip ? CHIP_LABEL[r.chip] : '–') },
          { key: 'transfers', label: 'Transfers', sortable: false, render: r => (r.sells?.length ? r.sells.map(([o], i) => `${player(o).web_name} → ${r.buys[i] ? player(r.buys[i][0]).web_name : '?'}`).join('; ') : '–') },
          { key: 'subs', label: 'Auto-subs', num: true, render: r => r.subs?.length || 0 },
          { key: 'rationale', label: 'Rationale', sortable: false, render: r => (r.rationale ? h('details', null, h('summary', null, 'show'), h('p', { class: 'small', style: { whiteSpace: 'normal', maxWidth: '520px' } }, r.rationale)) : '–') },
        ], rows: t.history, sort: 'gw', dir: 'asc', pageSize: 38, empty: 'No gameweek settled yet.' })),
      );
    };
    drawDetail();
    app.append(section(h('h2', null, 'Manager'), detail));

    app.append(section('Across the league', h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h3', null, 'Shared picks'), dataTable({ columns: [
        { key: 'name', label: 'Player', sort: r => player(r.id).web_name, render: r => playerCell(player(r.id), `${short(player(r.id).team)} · ${posOf(player(r.id))} · ${money(player(r.id).now_cost)}`) },
        { key: 'count', label: 'Teams', num: true, render: r => bar(r.count / league.n_teams, `${r.count}/${league.n_teams}`) },
        { key: 'managers', label: 'Who', sortable: false, render: r => h('span', { class: 'small muted', style: { whiteSpace: 'normal' } }, r.managers.map(m => league.teams[m]?.display_name.replace('The ', '')).join(', ')) },
      ], rows: league.shared_picks, sort: 'count', pageSize: 15 })),
      h('div', { class: 'card' }, h('h3', null, `Captain votes · GW${league.next_gw}`), dataTable({ columns: [
        { key: 'name', label: 'Player', sort: r => player(r.id).web_name, render: r => playerCell(player(r.id), `${short(player(r.id).team)} · ${posOf(player(r.id))}`) },
        { key: 'count', label: 'Votes', num: true, render: r => bar(r.count / league.n_teams, `${r.count}`) },
      ], rows: league.captain_votes, sort: 'count', pageSize: 15, empty: 'No decisions locked yet.' })),
    )));
  }

  async function renderStats(app) {
    await context();
    const [probs, ticker, fixtures] = await Promise.all([load('probabilities'), load('ticker'), load('fixtures')]);
    app.append(pageHead('Stats', `Model ${probs.model.version} for GW${probs.gw} · trained on nothing, tuned on nothing: FPL strength ratings blended with this season’s xG (${probs.finished_gws.length} finished gameweek${probs.finished_gws.length === 1 ? '' : 's'}).`));
    const tabs = [['goals', 'Goal & assist odds'], ['clean-sheets', 'Clean sheets'], ['ticker', 'Fixture ticker'], ['results', 'Results'], ['model', 'How it works']];
    let active = (location.hash || '#goals').slice(1);
    if (!tabs.some(([k]) => k === active)) active = 'goals';
    const body = h('div');
    const nav = h('div', { class: 'pill-row', style: { marginBottom: '16px' } }, tabs.map(([k, label]) => h('button', { class: `pill ${k === active ? 'active' : ''}`, onclick: () => { active = k; history.replaceState(null, '', `#${k}`); nav.querySelectorAll('.pill').forEach(b => b.classList.toggle('active', b.textContent === label)); draw(); } }, label)));
    app.append(nav, body);
    window.addEventListener('hashchange', () => {
      const next = (location.hash || '#goals').slice(1);
      if (next === active || !tabs.some(([k]) => k === next)) return;
      active = next;
      nav.querySelectorAll('.pill').forEach(b => b.classList.toggle('active', b.textContent === tabs.find(([k]) => k === next)[1]));
      draw();
    });

    const fixtureCell = r => h('span', { class: 'pill-row' }, r.fixtures.length ? r.fixtures.map(f => fdr(f.difficulty, `${short(f.opponent)}${f.home ? '' : ' (a)'}`)) : fdr(null, 'blank'));
    const draw = () => {
      body.innerHTML = '';
      if (active === 'goals') {
        const state = { pos: 'ALL', team: 'ALL', minMin: 45, q: '' };
        const holder = h('div');
        const redraw = () => {
          const rows = probs.players.filter(r => (state.pos === 'ALL' || r.position === state.pos) && (state.team === 'ALL' || r.team === Number(state.team)) && r.expected_minutes >= state.minMin && (!state.q || r.web_name.toLowerCase().includes(state.q)));
          holder.innerHTML = '';
          holder.append(dataTable({ columns: [
            { key: 'web_name', label: 'Player', dir: 'asc', render: r => playerCell(player(r.id), `${short(r.team)} · ${r.position} · ${money(r.now_cost)}`) },
            { key: 'fixtures', label: `GW${probs.gw}`, sortable: false, render: fixtureCell },
            { key: 'expected_minutes', label: 'xMins', num: true, title: 'Expected minutes: recent average × chance of playing' },
            { key: 'xg90', label: 'xG/90', num: true, render: r => num(r.xg90, 2) },
            { key: 'xa90', label: 'xA/90', num: true, render: r => num(r.xa90, 2) },
            { key: 'p_goal', label: 'P(goal)', num: true, render: r => bar(r.p_goal) },
            { key: 'p_assist', label: 'P(assist)', num: true, render: r => bar(r.p_assist) },
            { key: 'p_return', label: 'P(return)', num: true, title: 'Goal or assist', render: r => pct(r.p_return) },
            { key: 'p_clean_sheet', label: 'P(CS)', num: true, render: r => pct(r.p_clean_sheet) },
            { key: 'xpts', label: 'xPts', num: true, title: 'Model expected points (no bonus)', render: r => num(r.xpts, 1) },
            { key: 'ep_next', label: 'FPL ep', num: true, title: 'FPL’s own expected points for next GW', render: r => num(r.ep_next, 1) },
          ], rows, sort: 'p_goal', pageSize: 40, empty: 'No players match those filters.' }));
        };
        body.append(h('div', { class: 'controls' },
          h('input', { type: 'search', placeholder: 'Search player', oninput: e => { state.q = e.target.value.trim().toLowerCase(); redraw(); } }),
          h('span', { class: 'pill-row' }, ['ALL', 'GKP', 'DEF', 'MID', 'FWD'].map(p => h('button', { class: `pill ${state.pos === p ? 'active' : ''}`, onclick: e => { state.pos = p; e.target.parentElement.querySelectorAll('.pill').forEach(b => b.classList.toggle('active', b.textContent === p)); redraw(); } }, p))),
          h('label', null, 'Team ', h('select', { onchange: e => { state.team = e.target.value; redraw(); } }, h('option', { value: 'ALL' }, 'All'), ctx.teamList.map(t => h('option', { value: t.id }, t.name)))),
          h('label', null, 'Min xMins ', h('input', { type: 'number', value: state.minMin, min: 0, max: 90, onchange: e => { state.minMin = Number(e.target.value) || 0; redraw(); } })),
        ), holder);
        redraw();
      } else if (active === 'clean-sheets') {
        body.append(dataTable({ columns: [
          { key: 'team', label: 'Team', dir: 'asc', sort: r => team(r.team).name, render: r => h('strong', null, team(r.team).name) },
          { key: 'opponent', label: 'Opponent', sort: r => team(r.opponent).name, render: r => `${r.home ? 'v' : '@'} ${team(r.opponent).name}` },
          { key: 'difficulty', label: 'FDR', num: true, render: r => fdr(r.difficulty) },
          { key: 'kickoff_time', label: 'Kick-off', render: r => fmtDate(r.kickoff_time) },
          { key: 'xg_for', label: 'xG for', num: true, render: r => num(r.xg_for, 2) },
          { key: 'xg_against', label: 'xG against', num: true, render: r => num(r.xg_against, 2) },
          { key: 'p_clean_sheet', label: 'P(clean sheet)', num: true, render: r => bar(r.p_clean_sheet) },
          { key: 'p_score', label: 'P(score)', num: true, render: r => pct(r.p_score) },
          { key: 'p_concede_2plus', label: 'P(concede 2+)', num: true, render: r => pct(r.p_concede_2plus) },
        ], rows: probs.teams, sort: 'p_clean_sheet', pageSize: 40, empty: 'No fixtures for the next gameweek yet.' }));
        const ratings = Object.entries(probs.ratings || {}).map(([tid, r]) => ({ team: Number(tid), ...r }));
        body.append(section('Team ratings behind the numbers', h('p', { class: 'muted small' }, 'Goal multipliers: 1.00 is league average. Attack above 1 scores more; defence above 1 concedes more. Matches = finished games with xG data feeding the blend.'), dataTable({ columns: [
          { key: 'team', label: 'Team', dir: 'asc', sort: r => team(r.team).name, render: r => team(r.team).name },
          { key: 'attack_home', label: 'Att (H)', num: true, render: r => num(r.attack_home, 2) },
          { key: 'attack_away', label: 'Att (A)', num: true, render: r => num(r.attack_away, 2) },
          { key: 'defence_home', label: 'Def (H)', num: true, render: r => num(r.defence_home, 2) },
          { key: 'defence_away', label: 'Def (A)', num: true, render: r => num(r.defence_away, 2) },
          { key: 'matches', label: 'Matches', num: true },
          { key: 'xg_for', label: 'xG for', num: true, render: r => num(r.xg_for, 2) },
          { key: 'xg_against', label: 'xG against', num: true, render: r => num(r.xg_against, 2) },
        ], rows: ratings, sort: 'attack_home', pageSize: 20 })));
      } else if (active === 'ticker') {
        if (!ticker) { body.append(h('p', { class: 'muted' }, 'No upcoming fixtures.')); return; }
        body.append(h('p', { class: 'muted small' }, 'FPL fixture difficulty rating, 1 (easiest) to 5. Sorted by average difficulty over the run; click a heading to re-sort.'));
        body.append(h('div', { class: 'ticker' }, dataTable({ columns: [
          { key: 'team', label: 'Team', dir: 'asc', sort: r => team(r.team).name, render: r => h('strong', null, team(r.team).name) },
          ...ticker.gws.map((gw, i) => ({ key: `gw${gw}`, label: `GW${gw}`, sort: r => (r.gws[i].length ? r.gws[i].reduce((s, f) => s + (f.difficulty || 3), 0) / r.gws[i].length : 6), render: r => h('span', { class: 'pill-row' }, r.gws[i].length ? r.gws[i].map(f => fdr(f.difficulty, [`${short(f.opponent)}`, h('small', null, f.home ? 'home' : 'away')])) : fdr(null, '–')) })),
          { key: 'fixtures', label: 'Games', num: true },
          { key: 'avg_difficulty', label: 'Avg FDR', num: true, dir: 'asc', render: r => num(r.avg_difficulty, 2) },
        ], rows: ticker.teams, sort: 'avg_difficulty', dir: 'asc', pageSize: 20 })));
      } else if (active === 'results') {
        const played = fixtures.filter(f => f.finished || f.started).sort((a, b) => (b.event - a.event) || (new Date(b.kickoff_time) - new Date(a.kickoff_time)));
        body.append(dataTable({ columns: [
          { key: 'event', label: 'GW', num: true },
          { key: 'kickoff_time', label: 'Kick-off', render: r => fmtDate(r.kickoff_time) },
          { key: 'team_h', label: 'Home', sort: r => team(r.team_h).name, render: r => team(r.team_h).name },
          { key: 'score', label: 'Score', sortable: false, render: r => h('strong', null, `${r.team_h_score ?? '–'} – ${r.team_a_score ?? '–'}`) },
          { key: 'team_a', label: 'Away', sort: r => team(r.team_a).name, render: r => team(r.team_a).name },
          { key: 'finished', label: 'Status', render: r => (r.finished ? h('span', { class: 'badge' }, 'FT') : h('span', { class: 'badge amber' }, `live ${r.minutes}’`)) },
        ], rows: played, sort: 'event', pageSize: 40, empty: 'No results yet.' }));
      } else {
        const m = probs.model;
        body.append(h('div', { class: 'card' }, h('h2', null, `Model ${m.version}`),
          h('h3', null, 'Team goals'), h('p', null, m.team_goals),
          h('h3', null, 'Clean sheets'), h('p', null, m.clean_sheet),
          h('h3', null, 'Players'), h('p', null, m.player),
          h('h3', null, 'Expected points'), h('p', null, m.xpts),
          h('p', { class: 'muted small' }, 'Deterministic and reproducible from the raw snapshots: the code is eval/probabilities.py in the shadow-league repo. Compare against FPL’s own ep_next column; where the two disagree, one of them is wrong and we will find out on Sunday.')));
      }
    };
    draw();
  }

  async function renderPlayers(app) {
    await context();
    app.append(pageHead('Players', `Every player in the FPL API as of ${fmtStamp(ctx.meta.as_of)}. Click a row for the full record.`));
    const state = { pos: 'ALL', team: 'ALL', maxPrice: 200, q: '', minMinutes: 0 };
    const holder = h('div');
    const cols = [
      { key: 'web_name', label: 'Player', dir: 'asc', render: r => playerCell(r) },
      { key: 'team', label: 'Club', sort: r => short(r.team), render: r => short(r.team) },
      { key: 'element_type', label: 'Pos', render: r => posOf(r) },
      { key: 'now_cost', label: 'Price', num: true, render: r => money(r.now_cost) },
      { key: 'selected_by_percent', label: 'Own %', num: true, sort: r => Number(r.selected_by_percent), render: r => `${r.selected_by_percent}%` },
      { key: 'total_points', label: 'Pts', num: true },
      { key: 'event_points', label: 'GW', num: true },
      { key: 'form', label: 'Form', num: true, sort: r => Number(r.form) },
      { key: 'points_per_game', label: 'PPG', num: true, sort: r => Number(r.points_per_game) },
      { key: 'minutes', label: 'Mins', num: true },
      { key: 'goals_scored', label: 'G', num: true },
      { key: 'assists', label: 'A', num: true },
      { key: 'clean_sheets', label: 'CS', num: true },
      { key: 'expected_goals', label: 'xG', num: true, sort: r => Number(r.expected_goals) },
      { key: 'expected_assists', label: 'xA', num: true, sort: r => Number(r.expected_assists) },
      { key: 'expected_goal_involvements', label: 'xGI', num: true, sort: r => Number(r.expected_goal_involvements) },
      { key: 'expected_goals_conceded', label: 'xGC', num: true, sort: r => Number(r.expected_goals_conceded) },
      { key: 'bonus', label: 'Bonus', num: true },
      { key: 'bps', label: 'BPS', num: true },
      { key: 'ict_index', label: 'ICT', num: true, sort: r => Number(r.ict_index) },
      { key: 'ep_next', label: 'FPL ep', num: true, sort: r => Number(r.ep_next), render: r => num(r.ep_next, 1) },
      { key: 'transfers_in_event', label: 'In (GW)', num: true, render: r => (r.transfers_in_event || 0).toLocaleString('en-GB') },
      { key: 'transfers_out_event', label: 'Out (GW)', num: true, render: r => (r.transfers_out_event || 0).toLocaleString('en-GB') },
    ];
    const redraw = () => {
      const rows = ctx.playerList.filter(r => POS[r.element_type] && (state.pos === 'ALL' || POS[r.element_type] === state.pos) && (state.team === 'ALL' || r.team === Number(state.team)) && r.now_cost <= state.maxPrice && r.minutes >= state.minMinutes && (!state.q || `${r.web_name} ${r.first_name} ${r.second_name}`.toLowerCase().includes(state.q)));
      holder.innerHTML = '';
      holder.append(dataTable({ columns: cols, rows, sort: 'total_points', pageSize: 50, onRow: r => openPlayer(r.id) }));
    };
    app.append(h('div', { class: 'controls' },
      h('input', { type: 'search', placeholder: 'Search player', oninput: e => { state.q = e.target.value.trim().toLowerCase(); redraw(); } }),
      h('span', { class: 'pill-row' }, ['ALL', 'GKP', 'DEF', 'MID', 'FWD'].map(p => h('button', { class: `pill ${state.pos === p ? 'active' : ''}`, onclick: e => { state.pos = p; e.target.parentElement.querySelectorAll('.pill').forEach(b => b.classList.toggle('active', b.textContent === p)); redraw(); } }, p))),
      h('label', null, 'Club ', h('select', { onchange: e => { state.team = e.target.value; redraw(); } }, h('option', { value: 'ALL' }, 'All'), ctx.teamList.map(t => h('option', { value: t.id }, t.name)))),
      h('label', null, 'Max price ', h('input', { type: 'number', value: '20.0', step: '0.5', min: '3.5', max: '20', onchange: e => { state.maxPrice = Math.round(Number(e.target.value) * 10) || 200; redraw(); } })),
      h('label', null, 'Min mins ', h('input', { type: 'number', value: 0, min: 0, step: 90, onchange: e => { state.minMinutes = Number(e.target.value) || 0; redraw(); } })),
    ), holder);
    redraw();
  }

  const pages = { hub: renderHub, overview: renderOverview, 'my-team': renderMyTeam, league: renderLeague, stats: renderStats, players: renderPlayers };
  document.addEventListener('DOMContentLoaded', async () => {
    const app = document.getElementById('app');
    try {
      const meta = await load('meta');
      renderChrome(meta);
      app.innerHTML = '';
      await (pages[PAGE] || renderHub)(app);
    } catch (err) {
      console.error(err);
      app.innerHTML = '';
      app.append(h('div', { class: 'notice warn' }, h('strong', null, 'Could not load the data. '), String(err.message || err)));
    }
  });
})();
