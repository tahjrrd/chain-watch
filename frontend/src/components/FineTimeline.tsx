import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FineYear } from '../types'
import { fmtInt, fmtMoney } from '../format'

// Deep-navy bars: fines are penalties, not revenue — never read as festive.
const BAR = '#1e293b'
const AXIS = '#5c6670'
const GRID = '#e2e5e9'
const AXIS_FONT = 12
const TREND_UP = '#b91c1c' // rising fines are bad
const TREND_DOWN = '#2e7d52' // var(--green)

type Props = {
  data: FineYear[]
  title?: string
}

// Round a max value up to a clean axis ceiling and produce 4 even ticks.
function niceTicks(max: number): number[] {
  if (max <= 0) return [0]
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const steps = [1, 2, 2.5, 5, 10]
  let step = pow
  for (const s of steps) {
    if (max / (pow * s) <= 4) {
      step = pow * s
      break
    }
  }
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-6; v += step) ticks.push(Math.round(v))
  return ticks
}

// Honest year-over-year trend: compares only the LAST TWO FULL years. The CMS
// ~3yr window truncates the earliest year, so a first-vs-last comparison is
// biased low at the start; the two most recent complete years are apples to
// apples. Rising fines are BAD (red ↑); falling are good (green ↓).
type Trend = { text: string; color: string } | null
function trendLabel(data: FineYear[]): Trend {
  const currentYear = new Date().getFullYear()
  const full = data.filter((d) => d.year < currentYear).sort((a, b) => a.year - b.year)
  if (full.length < 2) return null
  const prev = full[full.length - 2]
  const curr = full[full.length - 1]
  if (prev.fine_dollars <= 0) return null
  const pct = (curr.fine_dollars - prev.fine_dollars) / prev.fine_dollars
  const rising = curr.fine_dollars > prev.fine_dollars
  const arrow = rising ? '↑' : '↓'
  return {
    text: `${curr.year} vs ${prev.year}: ${arrow}${Math.round(Math.abs(pct) * 100)}%`,
    color: rising ? TREND_UP : TREND_DOWN,
  }
}

// Compact bar chart of fine_dollars by year. Renders nothing when empty.
export function FineTimeline({ data, title = 'Fines by year' }: Props) {
  if (!data || data.length === 0) return null

  const maxVal = Math.max(0, ...data.map((d) => d.fine_dollars))
  const ticks = niceTicks(maxVal)
  const axisMax = ticks[ticks.length - 1]
  const peakIndex = data.reduce(
    (best, d, i) => (d.fine_dollars > data[best].fine_dollars ? i : best),
    0,
  )
  const peak = data[peakIndex]
  const trend = trendLabel(data)

  return (
    <div className="fine-timeline">
      <h3 className="panel-title">
        {title}
        {trend && (
          <span className="dsr-trend" style={{ color: trend.color, fontWeight: 600 }}>
            {trend.text}
          </span>
        )}
      </h3>
      <div className="fine-caption">
        penalty inspection date; first and current years partial
      </div>
      <div style={{ width: '100%', height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 18, right: 8, bottom: 4, left: 4 }}
            barCategoryGap="30%"
          >
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: AXIS_FONT, fill: AXIS }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
            />
            <YAxis
              tick={{ fontSize: AXIS_FONT, fill: AXIS }}
              tickLine={false}
              axisLine={false}
              width={48}
              domain={[0, axisMax]}
              ticks={ticks}
              tickFormatter={(v) => fmtMoney(v as number)}
            />
            <Tooltip
              cursor={{ fill: 'rgba(92, 102, 112, 0.10)' }}
              content={<FineTooltip />}
            />
            <Bar
              dataKey="fine_dollars"
              fill={BAR}
              fillOpacity={0.85}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="fine_dollars"
                content={
                  <PeakLabel peakIndex={peakIndex} peak={peak} />
                }
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

type LabelProps = {
  x?: number
  y?: number
  width?: number
  index?: number
  peakIndex: number
  peak: FineYear
}

// Small label over the peak bar only, e.g. "$2.1M · 2024".
function PeakLabel({ x, y, width, index, peakIndex, peak }: LabelProps) {
  if (index !== peakIndex || x === undefined || y === undefined) return null
  const cx = x + (width ?? 0) / 2
  return (
    <text
      x={cx}
      y={y - 6}
      textAnchor="middle"
      fontSize={11}
      fontWeight={600}
      fill="#5c6670"
    >
      {`${fmtMoney(peak.fine_dollars)} · ${peak.year}`}
    </text>
  )
}

type TooltipInput = {
  active?: boolean
  payload?: Array<{ payload?: FineYear }>
}

function FineTooltip({ active, payload }: TooltipInput) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
  if (!row) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{row.year}</div>
      <div>{fmtMoney(row.fine_dollars)} in fines</div>
      <div className="dim">
        {fmtInt(row.fine_count)} {row.fine_count === 1 ? 'fine' : 'fines'}
      </div>
    </div>
  )
}
