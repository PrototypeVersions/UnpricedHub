"use strict";
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = (x) => typeof x === "number" && Number.isFinite(x);
  const fmt = (x, d = 3) => (isNum(x) ? `${x > 0 ? "+" : ""}${x.toFixed(d)}` : "–");
  const when = (s) => {
    if (!s) return "–";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
  };
  const day = (s) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "–");

  function band(b, sessions) {
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
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Running mean rank correlation with 95% band">
      <path class="band" d="${up}${dn}Z"/><line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
      <path class="line" d="${line}"/>
      <text x="${L - 8}" y="${y(0) + 4}" text-anchor="end">0</text>
      <text x="${L - 8}" y="${y(hi) + 10}" text-anchor="end">${hi.toFixed(2)}</text>
      <text x="${L - 8}" y="${y(lo)}" text-anchor="end">${lo.toFixed(2)}</text></svg>
      <p class="small muted">Weekly checks of the Hub's own scores, with a 95% band that stays valid however often it is checked.</p>`;
  }

  function labPanel(lab) {
    const c = lab.receipts || {};
    const recent = (lab.recent || []).filter((r) => r.status !== "already-received").slice(0, 6);
    const models = lab.models || [];
    return `<section class="lab">
      <h2>${esc(lab.name)}</h2>
      <p class="lede">${esc(lab.question)}</p>
      <p class="small"><a href="${esc(lab.site)}">Open the lab</a> · <a href="https://github.com/${esc(lab.repo)}">Repository</a></p>
      <div class="counts">
        <span><strong>${c.live ?? 0}</strong>received before the open</span>
        <span><strong>${c.late ?? 0}</strong>late (not scored live)</span>
        <span><strong>${(c.invalid ?? 0) + (c.conflict ?? 0)}</strong>invalid or changed</span>
      </div>
      ${lab.status === "awaiting-export" && !recent.length ? `<p class="empty">This lab has not published its first export yet.</p>` : ""}
      ${recent.length ? `<h3>Latest receipts</h3><div class="table-scroll"><table><thead><tr>
        <th class="l">Forecast</th><th>Received</th><th>Market opened</th><th class="l">Status</th></tr></thead><tbody>
        ${recent.map((r) => `<tr><td class="l">${esc(r.forecastId || "–")}</td><td>${esc(when(r.receivedAt))}</td>
          <td>${esc(when(r.entryOpen))}</td><td class="l status-${esc(r.status)}">${esc({ live: "On time", late: "Late", invalid: "Invalid", conflict: "Changed after receipt", unavailable: "Not reachable" }[r.status] || r.status)}${r.problems ? `: ${esc(r.problems[0])}` : ""}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
      ${models.length ? `<h3>Scored by the Hub</h3><div class="table-scroll"><table><thead><tr>
        <th class="l">Model</th><th class="l">Role</th><th class="l">Metric</th><th>Days scored</th><th>Average</th></tr></thead><tbody>
        ${models.map((m) => `<tr><td class="l">${esc(m.model)}</td><td class="l">${esc(m.role || "–")}</td><td class="l">${esc({ ic: "Rank correlation (higher is better)", brier: "Brier score (lower is better)", qlike: "QLIKE (lower is better)" }[m.metric])}</td>
          <td>${m.days}</td><td>${fmt(m.mean, 4)}</td></tr>`).join("")}</tbody></table></div>
        ${models.filter((m) => m.role === "champion" && m.metric === "ic").map((m) => band(m.band, m.sessions)).join("")}` :
        `<p class="small muted">Scores appear once forecasts the Hub received on time have reached their exit session.</p>`}
    </section>`;
  }

  fetch("data/hub.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    const main = document.getElementById("main");
    if (!d) { main.innerHTML = `<p class="empty">The Hub has not collected anything yet. Its first run happens before the next market open.</p>`; return; }
    main.innerHTML = `
      <h1>Two labs, one honest scorekeeper</h1>
      <p class="lede">Each Unpriced lab asks a different question, so they are never ranked against each other. The Hub's job is to prove when each forecast existed and to check each lab's results with data the lab does not control.</p>
      <ol class="steps">${d.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>
      ${d.labs.map(labPanel).join("")}
      <p class="small muted">Updated ${esc(when(d.updatedAt))}.</p>`;
  });
})();
