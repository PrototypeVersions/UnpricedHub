"use strict";
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = (x) => typeof x === "number" && Number.isFinite(x);
  const signed = (x, d = 3) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}` : "–");
  const pct = (x, d = 1) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(d)}%` : "–");
  const prob = (x) => (isNum(x) ? `${x < 0.01 && x > 0 ? "<1" : Math.round(x * 100)}%` : "–");
  const move = (x) => (isNum(x) ? `±${x.toFixed(2)}%` : "–");
  const tone = (x) => (isNum(x) ? (x > 0 ? "pos" : x < 0 ? "neg" : "") : "");
  const when = (s) => {
    if (!s) return "–";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
  };
  const day = (s, wd = false) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { ...(wd ? { weekday: "short" } : {}), month: "short", day: "numeric" }) : "–");
  const span = (f) => `${day(f.entrySession)} – ${day(f.exitSession)}`;
  const lead = (m) => {
    if (!isNum(m)) return "";
    const a = Math.abs(m), h = Math.floor(a / 60), mm = a % 60;
    const t = h ? `${h} hr${mm ? ` ${mm} min` : ""}` : `${mm} min`;
    return m >= 0 ? `${t} before the open` : `${t} after the open`;
  };

  // ---------- plain names ----------
  const FUNDS = {
    SPY: "S&P 500 (whole market)", XLB: "Materials", XLE: "Energy", XLF: "Financials", XLI: "Industrials",
    XLK: "Technology", XLP: "Consumer staples", XLU: "Utilities", XLV: "Health care", XLY: "Consumer discretionary",
  };
  const QUESTION = {
    rank: "Which stocks will beat the others?",
    swing: "How much will prices swing?",
    fall: "Will prices fall more than 3%?",
  };
  const RISK_MODELS = {
    ewma: ["EWMA", "Recent daily moves, weighted toward the latest days"],
    har_daily: ["HAR", "A blend of the last day's, week's and month's moves"],
    garch11: ["GARCH", "A model in which a big move today raises the expected size of tomorrow's"],
    base_rate: ["Past frequency", "How often a fall this large happened in the past"],
    volatility_only: ["From recent swings", "Estimated from how much prices have been moving lately"],
  };
  const shortModel = (id) => (RISK_MODELS[id] ? RISK_MODELS[id][0] : modelLabel(id));
  function modelLabel(id) {
    if (RISK_MODELS[id]) return `${RISK_MODELS[id][0]}: ${RISK_MODELS[id][1].toLowerCase()}`;
    const name = String(id).replace(/-[0-9a-f]{8}$/, "");
    const g = name.match(/^(llm|rule)_guidance-on-(.+)$/);
    if (g) return `${modelLabel(g[2])}, adjusted by ${g[1] === "llm" ? "an AI reading of company filings" : "a keyword rule on company filings"}`;
    const parts = name.split(/~|-(?=[a-z])/), root = parts[0].split("_");
    if (root[0] === "factor") return `Single signal: ${{ ret: "last week's return", ret_1w: "last week's return" }[root.slice(1).join("_")] || root.slice(1).join(" ")}`;
    const bits = [{ ens: "Blend of models", gbm: "Tree model", ridge: "Linear model" }[root[0]] || root[0]];
    root.slice(1).forEach((t) => { if (!/^h\d+$/.test(t)) bits.push({ all: "all signals", price: "price signals only" }[t] || t); });
    parts.slice(1).forEach((m) => { if (m.startsWith("no_")) bits.push(`without ${m.slice(3).replace(/_/g, " ")}`); });
    return bits.join(", ");
  }
  const ROLE = { champion: "main model", challenger: "challenger", baseline: "simple benchmark" };
  const METRIC = {
    ic: ["Ranking skill", "1 is a perfect order, 0 is no better than chance, −1 is exactly backwards. Held over months, 0.02 to 0.05 is very good.", true],
    qlike: ["Swing error (QLIKE)", "0 is perfect. Lower is better, and under-estimating risk costs more than over-estimating it.", false],
    brier: ["Probability error (Brier)", "0 is perfect. Always saying 50% scores 0.25. Lower is better.", false],
  };
  const STATUS = { live: "On time", late: "Late", invalid: "Rejected", conflict: "Changed after receipt" };

  let D = null;
  let logFilter = "all";

  // ---------- small renderers ----------
  const tick = (t, i) => `<li><span class="rank">${i + 1}</span><span class="ticker">${esc(t)}</span></li>`;
  const tickRet = (t, r, i) => `<li><span class="rank">${i + 1}</span><span class="ticker">${esc(t)}</span>${r === undefined ? "" : `<span class="ret ${tone(r)}">${pct(r)}</span>`}</li>`;
  const stamp = (f) => `<span class="stamp status-${esc(f.status)}">${esc(STATUS[f.status] || f.status)}</span>`;
  const range = (vals, fmt) => {
    const v = vals.filter(isNum);
    if (!v.length) return "–";
    const lo = Math.min(...v), hi = Math.max(...v);
    return lo === hi || fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo)} to ${fmt(hi).replace(/^±/, "")}`;
  };

  function picksBlock(f, compact) {
    const c = f.content, o = f.outcome;
    return `<div class="picks">
      <div><h4>Expected to do best</h4><ol class="tickers">${c.top.map((t, i) => (o ? tickRet(t, o.top[i], i) : tick(t, i))).join("")}</ol>
        ${o ? `<p class="avg">Average: <strong class="${tone(o.topAvg)}">${pct(o.topAvg)}</strong></p>` : ""}</div>
      <div><h4>Expected to do worst</h4><ol class="tickers">${c.bottom.map((t, i) => (o ? tickRet(t, o.bottom[i], i) : tick(t, i))).join("")}</ol>
        ${o ? `<p class="avg">Average: <strong class="${tone(o.bottomAvg)}">${pct(o.bottomAvg)}</strong></p>` : ""}</div>
    </div>
    ${compact ? "" : `<p class="small muted">Out of ${c.count.toLocaleString("en-US")} of the most-traded US stocks, ranked by the lab's ${esc(ROLE[c.role] || "model")} (${esc(modelLabel(c.model))}). The ranking compares stocks with each other: it says nothing about whether the market as a whole will rise or fall.</p>`}`;
  }

  function riskTable(swing, fall) {
    const assets = (swing || fall).content.assets;
    const sv = swing ? swing.content.models.map((m) => swing.content.values[m.id]) : [];
    const fv = fall ? fall.content.models.map((m) => fall.content.values[m.id]) : [];
    return `<div class="table-scroll"><table class="risk"><thead><tr><th class="l">Fund</th>
      ${swing ? `<th>Typical daily move</th>` : ""}${fall ? `<th>Chance of a fall of more than ${Math.round((fall.content.threshold ?? 0.03) * 100)}%</th>` : ""}</tr></thead><tbody>
      ${assets.map((a, i) => `<tr><td class="l"><span class="ticker">${esc(a)}</span> <span class="muted">${esc(FUNDS[a] || "")}</span></td>
        ${swing ? `<td>${range(sv.map((v) => v[i]), move)}</td>` : ""}${fall ? `<td>${range(fv.map((v) => v[i]), prob)}</td>` : ""}</tr>`).join("")}
      </tbody></table></div>`;
  }

  // ---------- page sections ----------
  function hero() {
    const live = D.forecasts.filter((f) => f.status === "live").length;
    const checked = D.forecasts.filter((f) => f.outcome).length;
    const next = D.labs.map((l) => l.nextResults).filter(Boolean).sort()[0];
    return `<section class="hero">
      <p class="eyebrow">Independent scorekeeper</p>
      <h1>Forecasts locked in before the market opens, then checked against what happened.</h1>
      <p class="lede">Two AI-run research labs publish stock-market forecasts every trading evening. UnpricedHub is their referee. It saves its own copy of each forecast before the 9:30 am opening bell, so nothing can be changed after the fact. Five trading days later it checks the forecast against real prices.</p>
      <ol class="flow">
        <li><span class="n">1</span><h3>A lab forecasts</h3><p>After the market closes, each lab freezes its forecast for the next five trading days.</p></li>
        <li><span class="n">2</span><h3>The Hub locks it in</h3><p>The Hub downloads and time-stamps its own copy. Only copies it has before the open count.</p></li>
        <li><span class="n">3</span><h3>The Hub checks it</h3><p>When the five days are over, the Hub fetches prices itself and grades the forecast.</p></li>
      </ol>
      <div class="stats">
        <div><strong>${D.forecasts.length}</strong><span>forecasts received</span></div>
        <div><strong>${live}</strong><span>locked in on time</span></div>
        <div><strong>${checked}</strong><span>checked so far</span></div>
        <div><strong>${next ? esc(day(next, true)) : "–"}</strong><span>next results</span></div>
      </div>
    </section>`;
  }

  function latest() {
    const stock = D.forecasts.find((f) => f.kind === "rank");
    const riskDay = D.forecasts.find((f) => f.lab === "risk-lab" && f.content)?.decisionSession;
    const swing = D.forecasts.find((f) => f.kind === "swing" && f.decisionSession === riskDay);
    const fall = D.forecasts.find((f) => f.kind === "fall" && f.decisionSession === riskDay);
    const labOf = (id) => D.labs.find((l) => l.id === id) || {};
    const meta = (f) => `<p class="meta">${stamp(f)} <span>Locked in ${esc(when(f.receivedAt))}${f.status === "live" ? `, ${esc(lead(f.leadMinutes))}` : ""}</span></p>`;
    const visit = (l) => (l.site ? `<a class="visit" href="${esc(l.site)}">Visit the ${esc(String(l.name).replace(/^Unpriced /, ""))} →</a>` : "");
    const sl = labOf("stock-lab"), rl = labOf("risk-lab");
    return `<section class="block" id="latest">
      <h2>The latest forecasts</h2>
      <p class="sub">What each lab expects for the coming five trading days, exactly as the Hub received it.</p>
      <div class="cards">
        ${stock ? `<article class="card">
          <p class="card-lab">${esc(sl.name)}</p>
          <h3>${QUESTION.rank}</h3>
          <p class="window">For ${esc(span(stock))}</p>
          ${meta(stock)}
          ${picksBlock(stock, true)}
          <p class="small muted">Ranked out of ${stock.content.count.toLocaleString("en-US")} of the most-traded US stocks. It compares stocks with each other, not with the market.</p>
          <p class="card-foot"><button type="button" class="linklike" data-f="${esc(stock.forecastId)}">Full forecast and receipt</button>${visit(sl)}</p>
        </article>` : ""}
        ${swing || fall ? `<article class="card">
          <p class="card-lab">${esc(rl.name)}</p>
          <h3>How much will prices swing, and how likely is a fall?</h3>
          <p class="window">For ${esc(span(swing || fall))}</p>
          ${meta(swing || fall)}
          ${riskTable(swing, fall)}
          <p class="small muted">The lab runs several simple models and doesn't pick one, so each cell shows the range from lowest to highest. A typical daily move of ±1% means prices usually move up or down about 1% a day. A fall counts as more than 3% if the price at any close is more than 3% below its highest point since the window began.</p>
          <p class="card-foot">${swing ? `<button type="button" class="linklike" data-f="${esc(swing.forecastId)}">Daily-move forecast</button>` : ""}${fall ? `<button type="button" class="linklike" data-f="${esc(fall.forecastId)}">Chance-of-a-fall forecast</button>` : ""}${visit(rl)}</p>
        </article>` : ""}
      </div>
    </section>`;
  }

  function stockResults(lab) {
    const done = D.forecasts.filter((f) => f.lab === lab.id && f.kind === "rank" && f.outcome);
    if (!done.length) return pending(lab, "For each week the Hub will show how the top 10 and bottom 10 picks actually did, how the average stock did, and a ranking-skill score for every model.");
    const beat = done.filter((f) => isNum(f.outcome.topAvg) && isNum(f.outcome.bottomAvg) && f.outcome.topAvg > f.outcome.bottomAvg).length;
    const lead = done[0].content.model;
    const icOf = (f, m) => f.grades.find((g) => g.model === m)?.value;
    return `<p>In <strong>${beat} of ${done.length}</strong> checked forecast${done.length === 1 ? "" : "s"}, the top 10 picks did better than the bottom 10.</p>
      <div class="table-scroll"><table><thead><tr><th class="l">Forecast window</th><th>Top 10 picks</th><th>Bottom 10 picks</th><th>Average stock</th><th>Ranking skill</th></tr></thead><tbody>
      ${done.map((f) => `<tr class="clickable" data-f="${esc(f.forecastId)}" tabindex="0"><td class="l">${esc(span(f))}</td>
        <td class="${tone(f.outcome.topAvg)}">${pct(f.outcome.topAvg)}</td><td class="${tone(f.outcome.bottomAvg)}">${pct(f.outcome.bottomAvg)}</td>
        <td class="${tone(f.outcome.allAvg)}">${pct(f.outcome.allAvg)}</td><td>${signed(icOf(f, lead))}</td></tr>`).join("")}
      </tbody></table></div>
      ${modelTable(lab, "rank-score")}${bandChart(lab)}`;
  }

  function riskResults(lab) {
    const falls = D.forecasts.filter((f) => f.lab === lab.id && f.kind === "fall" && f.outcome);
    const swings = D.forecasts.filter((f) => f.lab === lab.id && f.kind === "swing" && f.outcome);
    if (!falls.length && !swings.length) return pending(lab, "For each forecast the Hub will show how much each fund actually moved, whether it fell more than 3%, and an error score for every model.");
    const rows = [...new Set([...falls, ...swings].map((f) => f.decisionSession))].sort().reverse();
    return `<div class="table-scroll"><table><thead><tr><th class="l">Forecast window</th><th>Funds that fell more than 3%</th><th>Actual daily move, S&amp;P 500</th><th class="l">Details</th></tr></thead><tbody>
      ${rows.map((d) => {
        const fa = falls.find((f) => f.decisionSession === d), sw = swings.find((f) => f.decisionSession === d), any = fa || sw;
        const hits = fa ? fa.outcome.hit.filter((h) => h === true).length : null, known = fa ? fa.outcome.hit.filter((h) => h !== null).length : 0;
        const spy = sw ? sw.outcome.actual[sw.content.assets.indexOf("SPY")] : null;
        return `<tr><td class="l">${esc(span(any))}</td><td>${fa ? `${hits} of ${known}` : "–"}</td><td>${move(spy)}</td>
          <td class="l">${sw ? `<button type="button" class="linklike" data-f="${esc(sw.forecastId)}">Daily moves</button>` : ""} ${fa ? `<button type="button" class="linklike" data-f="${esc(fa.forecastId)}">Falls</button>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>
      ${modelTable(lab, "variance")}${modelTable(lab, "event-probability")}`;
  }

  function pending(lab, what) {
    return `<p class="pending">${lab.nextResults ? `First results arrive the evening of <strong>${esc(day(lab.nextResults, true))}</strong>, after the first forecast's five trading days end.` : "Results appear once an on-time forecast's five trading days are over."}</p><p class="small muted">${what}</p>`;
  }

  function modelTable(lab, type) {
    const ms = lab.models.filter((m) => m.forecastType === type);
    if (!ms.length) return "";
    const [label, help] = METRIC[ms[0].metric] || [ms[0].metric, ""];
    const order = { champion: 0, challenger: 1, baseline: 2 };
    ms.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
    return `<h4 class="tight">${esc(label)} by model, averaged</h4><p class="small muted">${esc(help)}</p>
      <div class="table-scroll"><table><thead><tr><th class="l">Model</th><th class="l">Role</th><th>Forecasts graded</th><th>Average</th></tr></thead><tbody>
      ${ms.map((m) => `<tr><td class="l" title="${esc(m.model)}">${esc(modelLabel(m.model))}</td><td class="l">${esc(ROLE[m.role] || m.role || "")}</td><td>${m.days}</td><td>${signed(m.mean, 4)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  function bandChart(lab) {
    const m = lab.models.find((x) => x.role === "champion" && x.metric === "ic");
    const b = m && m.band;
    if (!b || !b.n || b.n < 2) return "";
    const W = 640, H = 200, L = 52, R = 10, T = 10, B = 26;
    let lo = Math.max(-0.25, Math.min(0, ...b.lower)), hi = Math.min(0.25, Math.max(0, ...b.upper));
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const n = b.mean.length, x = (i) => L + (i / (n - 1)) * (W - L - R);
    const y = (v) => T + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - T - B);
    const up = b.upper.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(""), dn = b.lower.map((_, i) => `L${x(n - 1 - i)},${y(b.lower[n - 1 - i])}`).join("");
    return `<h4 class="tight">Is the main model's skill real yet?</h4>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ranking skill of the main model so far, with its 95% range">
      <path class="band" d="${up}${dn}Z"/><line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
      <path class="line" d="${b.mean.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("")}"/>
      <text x="${L - 8}" y="${y(0) + 4}" text-anchor="end">0</text><text x="${L - 8}" y="${y(hi) + 10}" text-anchor="end">${hi.toFixed(2)}</text><text x="${L - 8}" y="${y(lo)}" text-anchor="end">${lo.toFixed(2)}</text></svg>
      <p class="small muted">The line is the average weekly ranking skill so far. The shaded band is where its true value plausibly lies. Only when the whole band sits above zero is there evidence of real skill, and the band stays valid however often it is checked.</p>`;
  }

  function results() {
    return `<section class="block" id="results">
      <h2>How the forecasts turned out</h2>
      <p class="sub">Graded by the Hub with its own price data. The labs answer different questions, so they are never ranked against each other.</p>
      ${D.labs.map((l) => `<div class="lab-result"><h3>${esc(l.name)}</h3>${l.id === "stock-lab" ? stockResults(l) : riskResults(l)}
        ${l.note ? `<p class="small muted">${esc(l.note)}</p>` : ""}</div>`).join("")}
    </section>`;
  }

  function resultCell(f) {
    if (f.status !== "live") return `<span class="muted">${f.status === "late" ? "Not graded (late)" : "Not graded"}</span>`;
    const o = f.outcome;
    if (!o) return `<span class="muted">Due ${esc(day(f.due))}</span>`;
    if (f.kind === "rank") return `Top 10 <span class="${tone(o.topAvg)}">${pct(o.topAvg)}</span> · bottom 10 <span class="${tone(o.bottomAvg)}">${pct(o.bottomAvg)}</span>`;
    if (f.kind === "fall") return `${o.hit.filter((h) => h === true).length} of ${o.hit.filter((h) => h !== null).length} fell more than 3%`;
    if (f.kind === "swing") return `S&amp;P 500 moved ${move(o.actual[f.content.assets.indexOf("SPY")])} a day`;
    return "Checked";
  }

  function log() {
    const rows = D.forecasts.filter((f) => logFilter === "all" || f.lab === logFilter);
    return `<section class="block" id="log">
      <h2>Every forecast received</h2>
      <p class="sub">The complete record, newest first. Nothing is ever removed or edited. Select a forecast to see what it said, its receipt and, once checked, how it did.</p>
      <div class="filters" role="group" aria-label="Show forecasts from">
        ${[["all", "All labs"], ...D.labs.map((l) => [l.id, l.name.replace(/^Unpriced /, "")])].map(([k, v]) => `<button type="button" class="toggle" data-filter="${esc(k)}" aria-pressed="${logFilter === k}">${esc(v)}</button>`).join("")}
      </div>
      <div class="table-scroll"><table class="log"><thead><tr><th class="l">Made after</th><th class="l">Lab</th><th class="l">Question</th><th class="l">Status</th><th class="l">Result</th></tr></thead><tbody>
      ${rows.map((f) => `<tr class="clickable" data-f="${esc(f.forecastId)}" tabindex="0"><td class="l">${esc(day(f.decisionSession, true))}</td>
        <td class="l">${esc(f.labName.replace(/^Unpriced /, ""))}</td><td class="l"><span class="q">${esc(QUESTION[f.kind] || f.taskId)}</span></td>
        <td class="l">${stamp(f)}</td><td class="l">${resultCell(f)}</td></tr>`).join("")}
      </tbody></table></div>
    </section>`;
  }

  function how() {
    return `<section class="block" id="how">
      <h2>How the checking works</h2>
      <dl class="grading">
        <dt>${QUESTION.rank}</dt>
        <dd>The Hub works out each stock's return from the first day's opening price to the opening price five trading days later. It then measures how well the lab's order matched the real order, a score called ranking skill: 1 is a perfect order, 0 is no better than chance, −1 is exactly backwards. Over months, 0.02 to 0.05 would be very good.</dd>
        <dt>${QUESTION.swing}</dt>
        <dd>The Hub measures how much each fund really moved each day over the window and compares it with the forecast using a standard error score (QLIKE). It is 0 for a perfect forecast and punishes under-estimating risk more than over-estimating it.</dd>
        <dt>${QUESTION.fall}</dt>
        <dd>The Hub checks whether, at any close in the window, the fund was more than 3% below its highest point so far. It scores the probability with the Brier score, the squared gap between the probability and what happened. 0 is perfect, and always saying 50% scores 0.25.</dd>
      </dl>
      <p class="small muted">Prices come from Yahoo Finance, the same public source the labs use, but the Hub downloads and calculates them itself. Forecasts received after the open are kept on record and never graded.</p>
    </section>`;
  }

  // ---------- popups ----------
  const PAGES = {
    about: () => ["About the Hub", `
      <p>Labs that grade their own forecasts can fool themselves, or be suspected of it. The Hub keeps score independently.</p>
      <ul class="steps">${(D?.rules || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      <p>It looks for new forecasts many times through the night and just before the open, and grades forecasts in its evening run once their five trading days are over.</p>`],
    format: () => ["What every forecast must include", `
      <p>Each lab sends one small file per forecast, in a fixed format. The Hub rejects any file that is missing something or doesn't add up.</p>
      <dl class="kv">
        <dt>An ID</dt><dd>Lab, day and question. A lab can never send two different forecasts under the same ID.</dd>
        <dt>Timing</dt><dd>The last trading day of data it used, the moment it was frozen, and when the forecast window starts and ends.</dd>
        <dt>The question</dt><dd>What is being forecast, in plain words, and which kind of forecast it is: a ranking, a probability or a size of price swings.</dd>
        <dt>The models</dt><dd>Every model's forecast, marked as the main model, a challenger or a simple benchmark.</dd>
        <dt>Gaps</dt><dd>Any stock or fund it chose not to forecast, with the reason.</dd>
        <dt>Caveats</dt><dd>Limits the reader should know about, in plain language.</dd>
      </dl>
      <h3>What the Hub checks</h3>
      <ul class="steps">
        <li>The file has every field, and every number is a real number.</li>
        <li>The forecast was frozen after its data and before the window it describes.</li>
        <li>The Hub had its copy before the 9:30 am ET open. If not, it is marked late and never graded.</li>
        <li>The trading days and prices it names agree with each other.</li>
        <li>It hasn't changed since the Hub first received it.</li>
      </ul>`],
    records: () => ["How records are kept", `
      <p>When a forecast arrives, the Hub saves its own exact copy along with the time it finished downloading. That time, not the lab's, decides whether the forecast was on time.</p>
      <p>Each copy gets a fingerprint (a SHA-256 hash): a code that changes completely if even one character of the file changes. If a lab later sends a different file under the same ID, the Hub records it as changed and keeps grading the first one.</p>
      <p>Receipts and grades are only ever added to. Nothing already recorded is edited or removed.</p>`],
  };

  function forecastPage(id) {
    const f = D.forecasts.find((x) => x.forecastId === id);
    if (!f) return ["Forecast", "<p>Not found.</p>"];
    const c = f.content, o = f.outcome;
    let what = "", happened = "";
    if (f.kind === "rank") {
      what = picksBlock(f, false);
      happened = o ? `<p>Over ${esc(span(f))}, the ${c.top.length} stocks ranked highest returned <strong class="${tone(o.topAvg)}">${pct(o.topAvg)}</strong> on average and the ${c.bottom.length} ranked lowest <strong class="${tone(o.bottomAvg)}">${pct(o.bottomAvg)}</strong>. The average stock returned <strong class="${tone(o.allAvg)}">${pct(o.allAvg)}</strong>.</p>
        <p>Over the top and bottom tenth (${o.tenth} stocks each): <span class="${tone(o.topTenthAvg)}">${pct(o.topTenthAvg)}</span> against <span class="${tone(o.bottomTenthAvg)}">${pct(o.bottomTenthAvg)}</span>.</p>
        ${o.best?.length ? `<p class="small muted">Best performers that week: ${o.best.map(([t, r]) => `${esc(t)} ${pct(r)}`).join(", ")}.</p>` : ""}` : "";
    } else if (f.kind === "swing" || f.kind === "fall") {
      const isSwing = f.kind === "swing", fmt = isSwing ? move : prob;
      const ms = c.models;
      what = `<p class="small muted">${isSwing ? "How much each fund is expected to move up or down on a typical day." : `The chance that, at some close in the window, the fund ends more than ${Math.round((c.threshold ?? 0.03) * 100)}% below its highest point so far.`} One column per model.</p>
        <div class="table-scroll"><table><thead><tr><th class="l">Fund</th>${ms.map((m) => `<th title="${esc(RISK_MODELS[m.id]?.[1] || "")}">${esc(shortModel(m.id))}</th>`).join("")}${o ? `<th class="actual">What happened</th>` : ""}</tr></thead><tbody>
        ${c.assets.map((a, i) => `<tr><td class="l"><span class="ticker">${esc(a)}</span> <span class="muted">${esc(FUNDS[a] || "")}</span></td>
          ${ms.map((m) => `<td>${fmt(c.values[m.id][i])}</td>`).join("")}
          ${o ? `<td class="actual">${isSwing ? move(o.actual[i]) : o.hit[i] === null ? "–" : `${o.hit[i] ? "Yes" : "No"} <span class="muted">(${pct(-o.actual[i])})</span>`}</td>` : ""}</tr>`).join("")}
        </tbody></table></div>
        <dl class="kv small">${ms.map((m) => `<dt>${esc(shortModel(m.id))}</dt><dd>${esc(RISK_MODELS[m.id]?.[1] || modelLabel(m.id))}</dd>`).join("")}</dl>`;
      happened = o ? `<p class="small muted">${isSwing ? "“What happened” is the fund's actual typical daily move over the window." : "“What happened” says whether the fund fell more than the threshold, with its largest fall from a high in brackets."}</p>` : "";
    }
    const gradeRows = f.grades.filter((g) => isNum(g.value));
    const grades = gradeRows.length ? `<div class="table-scroll"><table><thead><tr><th class="l">Model</th><th>${esc((METRIC[gradeRows[0].metric] || [gradeRows[0].metric])[0])}</th></tr></thead><tbody>
      ${gradeRows.map((g) => `<tr><td class="l">${esc(shortModel(g.model) === modelLabel(g.model) ? modelLabel(g.model) : shortModel(g.model))}${g.role === "champion" ? ` <span class="pill">main</span>` : ""}</td><td>${signed(g.value, 4)}</td></tr>`).join("")}
      </tbody></table></div><p class="small muted">${esc((METRIC[gradeRows[0].metric] || ["", ""])[1])}</p>` : "";
    const outcomeSection = f.status !== "live"
      ? `<p class="muted">${f.status === "late" ? "This forecast reached the Hub after the market opened, so it is kept on record but never graded." : "This forecast is kept on record but not graded."}</p>`
      : o ? `${happened}${grades}` : `<p class="pending">Not checked yet. The window ends ${esc(day(f.exitSession, true))}, and the Hub grades it the evening of ${esc(day(f.due, true))}.</p>`;
    const row = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : "");
    const body = `
      <p class="pop-meta">${stamp(f)} ${esc(f.labName)} · made after the close on ${esc(day(f.decisionSession, true))} · for ${esc(span(f))}</p>
      ${f.problems ? `<p class="neg">${esc(f.problems.join("; "))}</p>` : ""}
      <h3>The forecast</h3>${what || "<p class='muted'>No readable forecast.</p>"}
      <h3>How it turned out</h3>${outcomeSection}
      <h3>Receipt</h3>
      <dl class="kv">
        ${row("Frozen by the lab", esc(when(f.issuedAt)))}
        ${row("Received by the Hub", `${esc(when(f.receivedAt))}${f.leadMinutes !== undefined ? ` <span class="muted">(${esc(lead(f.leadMinutes))})</span>` : ""}`)}
        ${row("Market opened", esc(when(f.entryOpen)))}
        ${row("Forecast ID", `<code>${esc(f.forecastId)}</code>`)}
        ${row("Fingerprint", f.sha256 ? `<code class="hash">${esc(f.sha256)}</code>` : "")}
      </dl>
      ${f.limitations?.length ? `<details><summary>Caveats from the lab</summary><ul class="steps small">${f.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>` : ""}`;
    return [QUESTION[f.kind] || f.taskId, body];
  }

  const dlg = document.getElementById("pop");
  function openPop([title, body]) {
    dlg.querySelector("#pop-title").textContent = title;
    dlg.querySelector(".pop-body").innerHTML = body;
    dlg.querySelector(".pop-body").scrollTop = 0;
    if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
    dlg.querySelector(".pop-close").focus();
  }
  const closePop = () => (dlg.close ? dlg.close() : dlg.removeAttribute("open"));
  dlg.querySelector(".pop-close").addEventListener("click", closePop);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closePop(); });
  const activate = (el) => {
    if (el.dataset.f && D) openPop(forecastPage(el.dataset.f));
    else if (el.dataset.pop && PAGES[el.dataset.pop]) openPop(PAGES[el.dataset.pop]());
    else if (el.dataset.filter) { logFilter = el.dataset.filter; document.getElementById("log").outerHTML = log(); }
  };
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-f],[data-pop],[data-filter]");
    if (el && !e.target.closest("a")) activate(el);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-f]")) { e.preventDefault(); activate(e.target); }
  });

  fetch("data/hub.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    const main = document.getElementById("main");
    if (!d || !d.forecasts) { main.innerHTML = `<p class="empty">The Hub hasn't collected anything yet. Its first collection runs before the next market open.</p>`; return; }
    D = d;
    main.innerHTML = `${hero()}${latest()}${results()}${log()}${how()}<p class="small muted updated">Updated ${esc(when(d.updatedAt))}.</p>`;
  });
})();
