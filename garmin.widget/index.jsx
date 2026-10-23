// Garmin Connect 桌面小工具（Übersicht）
// 四張卡片：心率、HRV 狀態、本週跑步、本週騎乘。資料由同資料夾的 fetch.py 產生。
import { css } from "uebersicht";

export const command = `"$HOME/garmin-env/bin/python3" "$HOME/Library/Application Support/Übersicht/widgets/garmin.widget/fetch.py"`;

export const refreshFrequency = 15 * 60 * 1000; // 15 分鐘

// 位置與整體字型；要搬位置改這裡（目前在左側系統小工具正下方，直列一排）
export const className = `
  top: 378px;
  left: 18px;
  width: 260px;
  font-family: -apple-system, "SF Pro Text", "PingFang TC", "Helvetica Neue", sans-serif;
  color: rgba(255,255,255,0.92);
  -webkit-font-smoothing: antialiased;
`;

const ACCENT = "#5aa9ff";
const STATUS = {
  BALANCED: { label: "平衡", color: "#4cd37b" },
  UNBALANCED: { label: "不平衡", color: "#f5b942" },
  LOW: { label: "偏低", color: "#ff6b6b" },
  POOR: { label: "差", color: "#ff6b6b" },
};
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const grid = css`
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
`;
const card = css`
  background: rgba(18, 20, 26, 0.72);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 14px 16px 12px;
  min-height: 150px;
  box-sizing: border-box;
`;
const head = css`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  letter-spacing: 0.02em;
  color: rgba(255,255,255,0.62);
  margin-bottom: 6px;
`;
const big = css`
  display: flex;
  align-items: baseline;
  gap: 6px;
  line-height: 1;
  margin: 2px 0 6px;
`;
const num = css`
  font-size: 34px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;
const unit = css`
  font-size: 12px;
  color: rgba(255,255,255,0.62);
`;
const sub = css`
  font-size: 12px;
  color: rgba(255,255,255,0.72);
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
`;
const chip = css`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  color: #0b0d12;
`;
const foot = css`
  margin-top: 8px;
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  text-align: right;
`;
const chartBox = css`
  margin-top: 8px;
`;

function fmtHM(min) {
  if (!min) return "0 分";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} 小時 ${m} 分` : `${m} 分`;
}
function fmtMD(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${+m}/${+d}`;
}
function delta(cur, prev) {
  if (prev == null || cur == null) return null;
  const d = cur - prev;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}`;
}

// 今日心率折線
function Sparkline({ series, w = 228, h = 36 }) {
  if (!series || series.length < 2) return null;
  const min = Math.min(...series), max = Math.max(...series);
  const span = Math.max(1, max - min);
  const pts = series.map((v, i) =>
    `${(i / (series.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`
  ).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={ACCENT} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// 七日長條（週里程），todayIdx 可高亮今天；上方保留空間放數值標籤
function Bars({ values, colors, labels, w = 228, h = 56, todayIdx = -1, fmt }) {
  if (!values || !values.length) return null;
  const max = Math.max(1, ...values.map(v => v || 0));
  const gap = 6, bw = (w - gap * (values.length - 1)) / values.length;
  const labelH = 12, topPad = 12, barH = h - labelH - topPad - 2;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {values.map((v, i) => {
        const bh = v ? Math.max(2, ((v || 0) / max) * barH) : 2;
        const x = i * (bw + gap);
        const y0 = topPad + barH;
        const fill = colors ? colors[i] : ACCENT;
        const dim = v ? 1 : 0.25;
        return (
          <g key={i}>
            <rect x={x} y={y0 - bh} width={bw} height={bh} rx="2" fill={fill} opacity={dim} />
            {v && fmt ? (
              <text x={x + bw / 2} y={y0 - bh - 3} fontSize="9" textAnchor="middle"
                fill="rgba(255,255,255,0.7)">{fmt(v)}</text>
            ) : null}
            <text x={x + bw / 2} y={h - 1} fontSize="9" textAnchor="middle"
              fill={i === todayIdx ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)"}
              fontWeight={i === todayIdx ? "700" : "400"}>{labels ? labels[i] : ""}</text>
          </g>
        );
      })}
    </svg>
  );
}

// HRV 七夜圖：y 軸不從 0 起算，背後畫出「平衡」基線區間，長條依狀態上色
function HrvChart({ hist, low, high, w = 228, h = 56 }) {
  if (!hist || !hist.length) return null;
  const vals = hist.map(x => x.avg || 0);
  const present = vals.filter(v => v > 0);
  const lo = Math.min(...present, low ?? Infinity) - 6;
  const hi = Math.max(...present, high ?? -Infinity) + 6;
  const span = Math.max(1, hi - lo);
  const labelH = 12, topPad = 12, plotH = h - labelH - topPad - 2;
  const y = v => topPad + plotH - ((v - lo) / span) * plotH;
  const gap = 6, bw = (w - gap * (vals.length - 1)) / vals.length;
  const bandOk = low != null && high != null;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {bandOk ? (
        <rect x="0" y={y(high)} width={w} height={Math.max(1, y(low) - y(high))}
          fill="rgba(255,255,255,0.09)" rx="2" />
      ) : null}
      {hist.map((x, i) => {
        const v = x.avg || 0;
        const px = i * (bw + gap);
        const col = (STATUS[x.status] || { color: "rgba(255,255,255,0.4)" }).color;
        const top = v ? y(v) : topPad + plotH - 2;
        const bh = v ? Math.max(2, topPad + plotH - top) : 2;
        const today = i === hist.length - 1;
        return (
          <g key={i}>
            <rect x={px} y={top} width={bw} height={bh} rx="2" fill={col} opacity={v ? 1 : 0.25} />
            {v ? (
              <text x={px + bw / 2} y={top - 3} fontSize="9" textAnchor="middle"
                fill="rgba(255,255,255,0.7)">{v}</text>
            ) : null}
            <text x={px + bw / 2} y={h - 1} fontSize="9" textAnchor="middle"
              fill={today ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)"}
              fontWeight={today ? "700" : "400"}>{fmtMD(x.date).split("/")[1]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function HeartCard({ hr, stale }) {
  if (!hr) return <div className={card}><div className={head}>心率</div><div className={sub}>沒有資料</div></div>;
  return (
    <div className={card}>
      <div className={head}>
        <span>心率{stale ? "（舊資料）" : ""}</span>
        <span>{hr.latest ? `最新 ${hr.latest.hr} bpm · ${hr.latest.time}` : ""}</span>
      </div>
      <div className={big}>
        <span className={num}>{hr.resting ?? "–"}</span>
        <span className={unit}>靜止心率 bpm</span>
      </div>
      <div className={sub}>
        7 日平均 {hr.resting7d ?? "–"} · 今日 {hr.min ?? "–"}–{hr.max ?? "–"}
      </div>
      <div className={chartBox}><Sparkline series={hr.series} /></div>
    </div>
  );
}

function HrvCard({ hrv, stale }) {
  if (!hrv) return <div className={card}><div className={head}>HRV 狀態</div><div className={sub}>沒有資料</div></div>;
  const st = STATUS[hrv.status] || { label: hrv.status || "–", color: "rgba(255,255,255,0.5)" };
  const hist = (hrv.history || []).filter(x => x && x.date);
  return (
    <div className={card}>
      <div className={head}>
        <span>HRV 狀態{stale ? "（舊資料）" : ""}</span>
        <span className={chip} style={{ background: st.color }}>{st.label}</span>
      </div>
      <div className={big}>
        <span className={num}>{hrv.lastNight ?? "–"}</span>
        <span className={unit}>昨晚平均 ms</span>
      </div>
      <div className={sub}>
        週平均 {hrv.weekly ?? "–"} · 基線 {hrv.balancedLow ?? "–"}–{hrv.balancedUpper ?? "–"} · 5 分鐘高點 {hrv.high5min ?? "–"}
      </div>
      <div className={chartBox}>
        <HrvChart hist={hist} low={hrv.balancedLow} high={hrv.balancedUpper} />
      </div>
    </div>
  );
}

function WeekCard({ title, data, weekStart, stale }) {
  if (!data) return <div className={card}><div className={head}>{title}</div><div className={sub}>沒有資料</div></div>;
  const t = data.this, l = data.last;
  const todayIdx = (new Date().getDay()); // 0=日，與 Garmin 的週起始一致
  const d = delta(t.km, l.km);
  return (
    <div className={card}>
      <div className={head}>
        <span>{title}{stale ? "（舊資料）" : ""}</span>
        <span>{fmtMD(weekStart)} 起</span>
      </div>
      <div className={big}>
        <span className={num}>{t.km.toFixed(1)}</span>
        <span className={unit}>km</span>
      </div>
      <div className={sub}>
        {t.count} 次 · {fmtHM(t.min)} · 爬升 {t.elev} m
        <br />
        上週 {l.km.toFixed(1)} km{d != null ? `（${d} km）` : ""}
      </div>
      <div className={chartBox}>
        <Bars values={t.days} labels={WEEKDAYS} todayIdx={todayIdx} fmt={v => v.toFixed(1)} />
      </div>
    </div>
  );
}

export const render = ({ output, error }) => {
  if (error) return <div className={card}>小工具錯誤：{String(error)}</div>;
  let d;
  try { d = JSON.parse(output); } catch (e) {
    return <div className={card}><div className={head}>Garmin</div><div className={sub}>讀不到資料：{String(output).slice(0, 200)}</div></div>;
  }
  const stale = new Set(d.stale || []);
  const errs = Object.entries(d.errors || {});
  const acts = d.acts;
  return (
    <div>
      <div className={grid}>
        <HeartCard hr={d.hr} stale={stale.has("hr")} />
        <HrvCard hrv={d.hrv} stale={stale.has("hrv")} />
        <WeekCard title="本週跑步" data={acts && acts.run} weekStart={acts && acts.weekStart} stale={stale.has("acts")} />
        <WeekCard title="本週騎乘" data={acts && acts.bike} weekStart={acts && acts.weekStart} stale={stale.has("acts")} />
      </div>
      <div className={foot}>
        {errs.length ? `抓取失敗：${errs.map(([k, v]) => `${k} ${v}`).join("；")} · ` : ""}
        Garmin Connect · 更新 {d.updated}
      </div>
    </div>
  );
};
