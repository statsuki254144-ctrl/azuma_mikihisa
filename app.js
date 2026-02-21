const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vREk1VsXzGIVBKq27R9hDZZMvM3v5HAaRQfXpxMJnfuUZljh1p6OIf_FgKFAA8zyUc2PPYv8RepTH8d/pub?gid=2133702332&single=true&output=csv";
const BET_PER_RACE = 2000;

// ---------- utils ----------
function yen(n){
  const x = Math.round(Number(n) || 0);
  return x.toLocaleString("ja-JP") + "円";
}
function pct(ratio){
  if (!isFinite(ratio)) return "—";
  return (ratio * 100).toFixed(1) + "%";
}
function toDateObj(s){
  if (!s) return null;
  const t = String(s).trim().replace(/\./g,"/").replace(/-/g,"/");
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function fmtDate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}
function ymKey(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ISO week (Mon start)
function isoWeek(d){
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const isoYear = date.getUTCFullYear();

  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);

  const week = 1 + Math.round((date - firstThu) / (7*24*3600*1000));
  const key = `${isoYear}-W${String(week).padStart(2,"0")}`;
  return { key, week, year: isoYear, label: `${isoYear}年 第${week}週` };
}

// CSV parser
function parseCSV(text){
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i=0; i<text.length; i++){
    const ch = text[i];
    const next = text[i+1];

    if (ch === '"'){
      if (inQuotes && next === '"'){ cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes){
      row.push(cur); cur = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes){
      if (ch === "\r" && next === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(v => String(v).trim() !== "")) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  row.push(cur);
  if (row.some(v => String(v).trim() !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(h){
  const x = String(h || "").trim().toLowerCase();
  if (["date","日付","開催日"].includes(x)) return "date";
  if (["race","レース","レース名"].includes(x)) return "race";
  if (["honmei","本命","本命馬","本命馬名"].includes(x)) return "honmei";
  if (["ninki","人気","本命人気"].includes(x)) return "ninki";
  if (["chaku","着順","結果"].includes(x)) return "chaku";
  if (["payout","払戻","払い戻し","払戻金","回収額"].includes(x)) return "payout";
  if (["timestamp","タイムスタンプ"].includes(x)) return "timestamp";
  return x;
}

// ---------- DOM ----------
const yearlyRoiEl = document.getElementById("yearlyRoi");
const yearlyMetaEl = document.getElementById("yearlyMeta");
const rangeTextEl = document.getElementById("rangeText");
const countTextEl = document.getElementById("countText");
const monthlyTbody = document.querySelector("#monthlyTable tbody");
const weekSelect = document.getElementById("weekSelect");
const openWeekBtn = document.getElementById("openWeekBtn");
const weekSummary = document.getElementById("weekSummary");
const weekTbody = document.querySelector("#weekTable tbody");
const reloadBtn = document.getElementById("reloadBtn");

let rawRows = [];
let chart = null;

async function load(){
  const url = CSV_URL + (CSV_URL.includes("?") ? "&" : "?") + "t=" + Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV取得に失敗: ${res.status}`);
  const text = await res.text();

  const table = parseCSV(text);
  if (table.length < 2) return [];

  const headers = table[0].map(normalizeHeader);
  const idx = {};
  headers.forEach((h,i)=>{ idx[h]=i; });
  const pick = (arr, key) => arr[idx[key]] ?? "";

  const rows = [];
  for (let i=1; i<table.length; i++){
    const r = table[i];
    const d = toDateObj(pick(r,"date"));
    if (!d) continue;

    const row = {
      date: d,
      dateStr: fmtDate(d),
      race: String(pick(r,"race") ?? "").trim(),
      honmei: String(pick(r,"honmei") ?? "").trim(),
      ninki: Number(String(pick(r,"ninki") ?? "").replace(/[^\d.-]/g,"")) || null,
      chaku: Number(String(pick(r,"chaku") ?? "").replace(/[^\d.-]/g,"")) || null,
      bet: BET_PER_RACE,
      payout: Number(String(pick(r,"payout") ?? "").replace(/[^\d.-]/g,"")) || 0,
    };

    // 全部空っぽみたいな行は捨てる
    if (!row.race && !row.honmei && row.payout === 0) continue;

    rows.push(row);
  }

  rows.sort((a,b)=>a.date - b.date);
  return rows;
}

function renderAll(rows){
  rawRows = rows;

  if (rows.length){
    rangeTextEl.textContent = `${rows[0].dateStr} 〜 ${rows[rows.length-1].dateStr}`;
    countTextEl.textContent = `登録件数: ${rows.length}レース`;
  } else {
    rangeTextEl.textContent = "—";
    countTextEl.textContent = "登録件数: 0";
  }

  // 年間
  const totalPayout = rows.reduce((s,r)=>s+r.payout,0);
  const raceCount = rows.length;
  const totalBet = raceCount * BET_PER_RACE;
  const yearlyROI = totalBet > 0 ? totalPayout / totalBet : NaN;
  yearlyRoiEl.textContent = pct(yearlyROI);
  yearlyMetaEl.textContent = `投資 ${yen(totalBet)}（${raceCount}レース） / 払戻 ${yen(totalPayout)}`;

  // 日別
  const dayMap = new Map();
  for (const r of rows){
    const k = r.dateStr;
    if (!dayMap.has(k)) dayMap.set(k, { dateStr:k, date:r.date, payout:0, races:0 });
    const o = dayMap.get(k);
    o.payout += r.payout;
    o.races += 1;
  }
  const days = Array.from(dayMap.values()).sort((a,b)=>a.date - b.date);
  const dayLabels = days.map(d=>d.dateStr);
  const dayRoiPct = days.map(d=>{
    const bet = d.races * BET_PER_RACE;
    return bet > 0 ? (d.payout / bet) * 100 : null;
  });

  // 月別
  const monMap = new Map();
  for (const r of rows){
    const k = ymKey(r.date);
    if (!monMap.has(k)) monMap.set(k, { ym:k, payout:0, races:0 });
    const o = monMap.get(k);
    o.payout += r.payout;
    o.races += 1;
  }
  monthlyTbody.innerHTML = "";
  for (const m of Array.from(monMap.values()).sort((a,b)=>a.ym.localeCompare(b.ym))){
    const bet = m.races * BET_PER_RACE;
    const roi = bet > 0 ? m.payout / bet : NaN;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${m.ym}</td>
      <td>${pct(roi)}</td>
      <td>${yen(bet)}</td>
      <td>${yen(m.payout)}</td>
      <td>${m.races}</td>
    `;
    monthlyTbody.appendChild(tr);
  }

  // 週セレクト
  const wkMap = new Map();
  for (const r of rows){
    const w = isoWeek(r.date);
    if (!wkMap.has(w.key)) wkMap.set(w.key, w);
  }
  const weeks = Array.from(wkMap.values()).sort((a,b)=>a.key.localeCompare(b.key));
  weekSelect.innerHTML = "";
  for (const w of weeks){
    const opt = document.createElement("option");
    opt.value = w.key;
    opt.textContent = `${w.key}（${w.label}）`;
    weekSelect.appendChild(opt);
  }
  if (weeks.length){
    weekSelect.value = weeks[weeks.length-1].key; // 最新週
    renderWeek(weekSelect.value);
  } else {
    weekSummary.textContent = "—";
    weekTbody.innerHTML = "";
  }

  // グラフ
  const ctx = document.getElementById("roiChart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: dayLabels,
      datasets: [{
        label: "日別回収率",
        data: dayRoiPct,
        spanGaps: true,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      interaction: { mode: "nearest", intersect: false },
      scales: {
        y: { ticks: { callback: (v)=> `${v}%` } }
      },
      onClick: (evt) => {
        const pts = chart.getElementsAtEventForMode(evt, "nearest", { intersect:false }, true);
        if (!pts.length) return;
        const i = pts[0].index;
        const d = toDateObj(dayLabels[i]);
        if (!d) return;
        const w = isoWeek(d);
        weekSelect.value = w.key;
        renderWeek(w.key);
        document.querySelector("#weekTable").scrollIntoView({ behavior:"smooth", block:"start" });
      }
    }
  });
}

function renderWeek(weekKey){
  const rows = rawRows.filter(r => isoWeek(r.date).key === weekKey)
                      .sort((a,b)=>a.date - b.date);

  if (!rows.length){
    weekSummary.textContent = "その週のデータがありません。";
    weekTbody.innerHTML = "";
    return;
  }

  const payout = rows.reduce((s,r)=>s+r.payout,0);
  const races = rows.length;
  const bet = races * BET_PER_RACE;
  const roi = bet > 0 ? payout / bet : NaN;

  const from = rows[0].dateStr;
  const to = rows[rows.length-1].dateStr;
  const w = isoWeek(rows[0].date);

  weekSummary.textContent =
    `${weekKey}（${w.label}） ${from}〜${to} / 回収率 ${pct(roi)}（投資 ${yen(bet)}・払戻 ${yen(payout)}・${races}レース）`;

  weekTbody.innerHTML = "";
  for (const r of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.dateStr}</td>
      <td>${escapeHtml(r.race)}</td>
      <td>${escapeHtml(r.honmei)}</td>
      <td>${r.ninki ?? "—"}</td>
      <td>${r.chaku ?? "—"}</td>
      <td>${yen(r.bet)}</td>
      <td>${yen(r.payout)}</td>
    `;
    weekTbody.appendChild(tr);
  }
}

async function init(){
  try{
    const rows = await load();
    renderAll(rows);
  } catch (e){
    console.error(e);
    yearlyRoiEl.textContent = "読込エラー";
    yearlyMetaEl.textContent = String(e?.message || e);
  }
}

weekSelect.addEventListener("change", () => renderWeek(weekSelect.value));
openWeekBtn.addEventListener("click", () => renderWeek(weekSelect.value));
reloadBtn.addEventListener("click", init);

init();
