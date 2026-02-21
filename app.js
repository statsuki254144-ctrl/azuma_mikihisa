const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vREk1VsXzGIVBKq27R9hDZZMvM3v5HAaRQfXpxMJnfuUZljh1p6OIf_FgKFAA8zyUc2PPYv8RepTH8d/pub?gid=2133702332&single=true&output=csv";
const BET_PER_RACE = 2000;
const WINDOW_DAYS = 5;

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
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
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

// ---------- DOM ----------
const yearlyRoiEl = document.getElementById("yearlyRoi");
const yearlyMetaEl = document.getElementById("yearlyMeta");
const rangeTextEl = document.getElementById("rangeText");
const countTextEl = document.getElementById("countText");

const reloadBtn = document.getElementById("reloadBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const windowText = document.getElementById("windowText");

const dateChips = document.getElementById("dateChips");
const selectedDatePill = document.getElementById("selectedDatePill");
const daySummary = document.getElementById("daySummary");
const dayTbody = document.getElementById("dayTbody");

let rawRows = [];
let daily = [];          // [{dateStr, date, payout, races, roiRatio}]
let chart = null;
let windowStart = 0;     // dailyのindex
let selectedDateStr = null;

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
      payout: Number(String(pick(r,"payout") ?? "").replace(/[^\d.-]/g,"")) || 0,
    };

    // ほぼ空は捨てる
    if (!row.race && !row.honmei && row.payout === 0) continue;

    rows.push(row);
  }

  rows.sort((a,b)=>a.date - b.date);
  return rows;
}

function buildDaily(rows){
  const map = new Map();
  for (const r of rows){
    const k = r.dateStr;
    if (!map.has(k)) map.set(k, { dateStr:k, date:r.date, payout:0, races:0 });
    const o = map.get(k);
    o.payout += r.payout;
    o.races += 1;
  }
  const arr = Array.from(map.values()).sort((a,b)=>a.date - b.date);
  for (const d of arr){
    const bet = d.races * BET_PER_RACE;
    d.roiRatio = bet > 0 ? (d.payout / bet) : NaN;
  }
  return arr;
}

function setYearly(rows){
  const totalPayout = rows.reduce((s,r)=>s+r.payout,0);
  const raceCount = rows.length;
  const totalBet = raceCount * BET_PER_RACE;
  const yearlyROI = totalBet > 0 ? totalPayout / totalBet : NaN;

  yearlyRoiEl.textContent = pct(yearlyROI);
  yearlyMetaEl.textContent = `投資 ${yen(totalBet)}（${raceCount}レース） / 払戻 ${yen(totalPayout)}`;

  if (rows.length){
    rangeTextEl.textContent = `データ期間: ${rows[0].dateStr} 〜 ${rows[rows.length-1].dateStr}`;
    countTextEl.textContent = `登録: ${raceCount}レース`;
  } else {
    rangeTextEl.textContent = `データ期間: —`;
    countTextEl.textContent = `登録: 0レース`;
  }
}

function clampWindowStart(){
  const maxStart = Math.max(0, daily.length - WINDOW_DAYS);
  if (windowStart < 0) windowStart = 0;
  if (windowStart > maxStart) windowStart = maxStart;
}

function renderWindow(){
  clampWindowStart();

  const slice = daily.slice(windowStart, windowStart + WINDOW_DAYS);
  const labels = slice.map(x => x.dateStr);
  const dataPct = slice.map(x => isFinite(x.roiRatio) ? x.roiRatio * 100 : null);

  windowText.textContent =
    slice.length ? `${labels[0]} 〜 ${labels[labels.length-1]}（${slice.length}日）` : "—";

  // chips
  dateChips.innerHTML = "";
  for (const d of slice){
    const btn = document.createElement("button");
    btn.className = "chip" + (d.dateStr === selectedDateStr ? " active" : "");
    btn.type = "button";
    btn.innerHTML = `${d.dateStr}<small>回収 ${pct(d.roiRatio)}</small>`;
    btn.addEventListener("click", () => {
      selectedDateStr = d.dateStr;
      renderWindow();      // active反映
      renderDayDetail();
    });
    dateChips.appendChild(btn);
  }

  // chart
  const ctx = document.getElementById("roiChart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "回収率",
        data: dataPct,
        spanGaps: true,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      interaction: { mode:"nearest", intersect:false },
      plugins: {
        legend: { display:false },
        tooltip: {
          callbacks: {
            label: (c) => isFinite(c.parsed.y) ? `回収率 ${c.parsed.y.toFixed(1)}%` : "回収率 —"
          }
        }
      },
      scales: {
        y: {
          ticks: { callback: (v)=> `${v}%` }
        }
      },
      onClick: (evt) => {
        const pts = chart.getElementsAtEventForMode(evt, "nearest", { intersect:false }, true);
        if (!pts.length) return;
        const i = pts[0].index;
        const clickedDate = labels[i];
        if (!clickedDate) return;
        selectedDateStr = clickedDate;
        renderWindow();
        renderDayDetail();
        document.querySelector(".summary").scrollIntoView({ behavior:"smooth", block:"start" });
      }
    }
  });

  // nav enable/disable（雰囲気だけ）
  prevBtn.disabled = (windowStart <= 0);
  nextBtn.disabled = (windowStart >= Math.max(0, daily.length - WINDOW_DAYS));
}

function renderDayDetail(){
  if (!selectedDateStr){
    selectedDatePill.textContent = "—";
    daySummary.textContent = "日付を選択してください。";
    dayTbody.innerHTML = "";
    return;
  }

  selectedDatePill.textContent = selectedDateStr;

  const rows = rawRows.filter(r => r.dateStr === selectedDateStr);
  rows.sort((a,b)=> (a.race||"").localeCompare(b.race||""));

  const payout = rows.reduce((s,r)=>s+r.payout,0);
  const races = rows.length;
  const bet = races * BET_PER_RACE;
  const roi = bet > 0 ? payout / bet : NaN;

  daySummary.textContent =
    `${selectedDateStr}：回収率 ${pct(roi)}（投資 ${yen(bet)}・払戻 ${yen(payout)}・${races}レース）`;

  dayTbody.innerHTML = "";
  for (const r of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.race)}</td>
      <td>${escapeHtml(r.honmei)}</td>
      <td>${r.ninki ?? "—"}</td>
      <td>${r.chaku ?? "—"}</td>
      <td>${yen(r.payout)}</td>
    `;
    dayTbody.appendChild(tr);
  }
}

async function init(){
  yearlyRoiEl.textContent = "—";
  yearlyMetaEl.textContent = "—";

  try{
    rawRows = await load();
    setYearly(rawRows);

    daily = buildDaily(rawRows);

    // 初期：最新側の5日を表示
    windowStart = Math.max(0, daily.length - WINDOW_DAYS);

    // 初期選択：最新日
    selectedDateStr = daily.length ? daily[daily.length - 1].dateStr : null;

    renderWindow();
    renderDayDetail();
  } catch (e){
    console.error(e);
    yearlyRoiEl.textContent = "読込エラー";
    yearlyMetaEl.textContent = String(e?.message || e);
  }
}

// events
reloadBtn.addEventListener("click", init);
prevBtn.addEventListener("click", () => { windowStart -= WINDOW_DAYS; renderWindow(); });
nextBtn.addEventListener("click", () => { windowStart += WINDOW_DAYS; renderWindow(); });

init();
