"use strict";
(() => {
  const REPO = "https://github.com/PrototypeVersions/UnpricedHub";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = (x) => typeof x === "number" && Number.isFinite(x);
  const fmt = (x, d = 3) => (isNum(x) ? `${x > 0 ? "+" : ""}${x.toFixed(d)}` : "–");
  const when = (s) => {
    if (!s) return "–";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
  };
  const day = (s) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "–");

  // What each forecast is about, in words (the file name is kept as a tooltip).
  function taskLabel(r) {
    const t = r.taskId || "";
    if (r.forecastType === "rank-score") return "Which stocks will do better than the others";
    if (r.forecastType === "variance") return "How much prices will swing";
    if (r.forecastType === "event-probability" && /drawdown/.test(t)) {
      const m = t.match(/gt(\d+)pct/);
      return `Chance of a fall of more than ${m ? m[1] : "a set"}%`;
    }
    return t || "Forecast";
  }

  // Plain names for the models the labs publish.
  const RISK_MODELS = {
    ewma: "Recent swings, weighted toward the latest days (EWMA)",
    har_daily: "Blend of daily, weekly and monthly swings (HAR)",
    garch11: "Volatility model that reacts to shocks (GARCH)",
    base_rate: "How often it happened in the past",
    volatility_only: "Estimate from recent volatility alone",
  };
  function modelLabel(id) {
    if (RISK_MODELS[id]) return RISK_MODELS[id];
    const name = String(id).replace(/-[0-9a-f]{8}$/, "");
    const parts = name.split(/~|-(?=[a-z])/), root = parts[0].split("_");
    if (root[0] === "factor") return `Single signal: ${root.slice(1).join("_")}`;
    const bits = [{ ens: "Blend of models", gbm: "Tree model", ridge: "Linear model" }[root[0]] || root[0]];
    root.slice(1).forEach((t) => { if (!/^h\d+$/.test(t)) bits.push({ all: "all signals", price: "price signals only" }[t] || t); });
    parts.slice(1).forEach((m) => { if (m.startsWith("no_")) bits.push(`without ${m.slice(3).replace(/_/g, " ")}`); });
    return bits.join(", ");
  }
  const METRIC = {
    ic: "Ranking skill (above 0 is better than chance)",
    brier: "Brier score (lower is better)",
    qlike: "QLIKE loss (lower is better)",
  };

  function band(b) {
    if (!b || !b.n || !b.mean) return "";
    const W = 640, H = 200, L = 52, R = 10, T = 10, B = 26;
    let lo = Math.max(-0.25, Math.min(0, ...b.lower)), hi = Math.min(0.25, Math.max(0, ...b.upper));
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const n = b.mean.length;
    const x = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
    const cl = (v) => Math.max(lo, Math.min(hi, v));
    const y = (v) => T + (1 - (cl(v) - lo) / (hi - lo)) * (H - T - B);
    const up = b.upper.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
    const dn = b.lower.map((_, i) => `L${x(n - 1 - i)},${y(b.lower[n - 1 - i])}`).join("");
    const line = b.mean.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ranking skill so far, with its 95% range">
      <path class="band" d="${up}${dn}Z"/><line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
      <path class="line" d="${line}"/>
      <text x="${L - 8}" y="${y(0) + 4}" text-anchor="end">0</text>
      <text x="${L - 8}" y="${y(hi) + 10}" text-anchor="end">${hi.toFixed(2)}</text>
      <text x="${L - 8}" y="${y(lo)}" text-anchor="end">${lo.toFixed(2)}</text></svg>
      <p class="small muted">The model in charge, graded by the Hub week by week. The shaded range is where its true skill plausibly lies; it stays valid however often it is checked.</p>`;
  }

  function labPanel(lab) {
    const c = lab.receipts || {};
    const all = (lab.recent || []).filter((r) => r.status !== "already-received" && r.status !== "unavailable");
    const recent = all.slice(0, 6);
    const models = lab.models || [];
    const pendingLive = all.filter((r) => r.status === "live" && r.exitSession).map((r) => r.exitSession).sort();
    // the Hub grades a forecast from the calendar day after its exit session, in its evening run
    const nextDay = (d) => { const t = new Date(`${d}T12:00:00`); t.setDate(t.getDate() + 1); return t.toISOString().slice(0, 10); };
    const firstDue = pendingLive.length ? nextDay(pendingLive[0]) : null;
    const status = { live: "On time", late: "Late", invalid: "Rejected", conflict: "Changed after receipt" };
    return `<section class="lab">
      <h2>${esc(lab.name)}</h2>
      <p class="lede">${esc(lab.question)}</p>
      <p class="small"><a href="${esc(lab.site)}">Open the lab</a> · <a href="https://github.com/${esc(lab.repo)}">Its code and records</a></p>
      <div class="counts">
        <span><strong>${c.live ?? 0}</strong>on time</span>
        <span><strong>${c.late ?? 0}</strong>late (don't count)</span>
        <span><strong>${(c.invalid ?? 0) + (c.conflict ?? 0)}</strong>rejected or changed</span>
      </div>
      ${lab.note ? `<p class="small muted">${esc(lab.note)}</p>` : ""}
      ${lab.status === "awaiting-export" && !recent.length ? `<p class="empty">This lab hasn't sent its first forecast yet.</p>` : ""}
      ${recent.length ? `<h3>Latest forecasts received</h3><div class="table-scroll"><table><thead><tr>
        <th class="l">Forecast</th><th class="l">Status</th><th>Made after</th><th>Received</th><th>Market opened</th></tr></thead><tbody>
        ${recent.map((r) => `<tr><td class="l" title="${esc(r.forecastId || "")}">${r.storedAt ? `<a href="${REPO}/blob/main/${esc(r.storedAt)}">${esc(taskLabel(r))}</a>` : esc(taskLabel(r))}</td>
          <td class="l status-${esc(r.status)}">${esc(status[r.status] || r.status)}${r.problems ? `: ${esc(r.problems[0])}` : ""}</td>
          <td>${esc(day(r.decisionSession))}</td><td>${esc(when(r.receivedAt))}</td><td>${esc(when(r.entryOpen))}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
      ${models.length ? `<h3>Graded by the Hub</h3><div class="table-scroll"><table><thead><tr>
        <th class="l">Model</th><th class="l">Forecast</th><th class="l">Measure</th><th>Days graded</th><th>Average</th></tr></thead><tbody>
        ${models.map((m) => `<tr><td class="l" title="${esc(m.model)}">${esc(modelLabel(m.model))}${m.role === "champion" ? ` <span class="pill">in charge</span>` : ""}</td>
          <td class="l">${esc(taskLabel({ taskId: m.task, forecastType: { ic: "rank-score", brier: "event-probability", qlike: "variance" }[m.metric] }))}</td>
          <td class="l">${esc(METRIC[m.metric] || m.metric)}</td><td>${m.days}</td><td>${fmt(m.mean, 4)}</td></tr>`).join("")}</tbody></table></div>
        ${models.filter((m) => m.role === "champion" && m.metric === "ic").map((m) => band(m.band)).join("")}` :
        `<p class="small muted">${firstDue ? `The first grades are due on the evening of ${esc(day(firstDue))}, the day after the first on-time forecast's five trading days end.` : "Grades appear once an on-time forecast's five trading days are over."}</p>`}
    </section>`;
  }

  fetch("data/hub.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    const main = document.getElementById("main");
    if (!d) { main.innerHTML = `<p class="empty">The Hub hasn't collected anything yet. Its first collection runs before the next market open.</p>`; return; }
    main.innerHTML = `
      <h1>The independent record of the Unpriced labs</h1>
      <p class="lede">A receipt for every forecast. The Hub saves its own copy of each one before the market opens, so it can't be changed later, and grades it afterwards with its own price data.</p>
      <ul class="steps">${d.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      ${d.labs.map(labPanel).join("")}
      <section class="lab">
        <h2>How grading works</h2>
        <p>The Hub grades a forecast in its evening run on the day after the forecast's five trading days end. It downloads prices itself from Yahoo Finance (the same public source the labs use) and does its own calculation. Only forecasts it received before the open are graded. Each kind of forecast gets the standard measure for that kind of question:</p>
        <dl class="grading">
          <dt>Which stocks will do better than the others</dt>
          <dd>For every stock, the Hub works out the return from the entry open to the open five trading days later. It then measures how well the lab's ranking matched the actual order (a rank correlation). 1 would be a perfect order, 0 is no better than chance, and −1 is exactly backwards. Held over months, 0.02 to 0.05 would be very good.</dd>
          <dt>How much prices will swing</dt>
          <dd>The Hub measures the actual swing as the average squared daily move over the window (the first day from open to close, then close to close). It compares that with the forecast using QLIKE, a standard loss that is 0 for a perfect forecast and grows faster when risk is underestimated than when it is overestimated. Lower is better.</dd>
          <dt>Chance of a fall of more than 3%</dt>
          <dd>The Hub checks whether, at any close during the window, the price was more than 3% below the highest price reached so far, starting from the entry price (yes or no). It scores the forecast probability with the Brier score: the squared gap between the probability and what happened, averaged. 0 is perfect, and always saying 50% scores 0.25. Lower is better.</dd>
        </dl>
        <p class="small muted">The exact calculations are in <a href="${REPO}/blob/main/hub/score.py">hub/score.py</a>, and every receipt and grade is saved in the <a href="${REPO}/tree/main/records">records folder</a>.</p>
      </section>
      <p class="small muted">Updated ${esc(when(d.updatedAt))}.</p>`;
  });
})();
