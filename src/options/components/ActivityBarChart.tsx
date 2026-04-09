import { useMemo, useState } from 'react'
import { formatDurationMs } from '@/shared/format'

export type ActivityChartPoint = {
  dateKey: string
  label: string
  usedMs: number
  openCount: number
}

type Props = {
  data: ActivityChartPoint[]
}

const CHART_WIDTH = 860
const CHART_HEIGHT = 250
const PADDING = {
  top: 16,
  right: 18,
  bottom: 40,
  left: 48,
}

export default function ActivityBarChart({ data }: Props) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const chartMetrics = useMemo(() => {
    const maxUsedMs = Math.max(...data.map((point) => point.usedMs), 60_000)
    const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right
    const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom
    const step = data.length > 0 ? innerWidth / data.length : innerWidth
    const barWidth = Math.max(4, step - 3)

    return {
      maxUsedMs,
      innerWidth,
      innerHeight,
      step,
      barWidth,
    }
  }, [data])

  const hoveredPoint = hoveredIndex === null ? null : data[hoveredIndex]

  return (
    <div className="activityChartWrap">
      <svg className="activityChart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label="Screen time over the last 30 days">
        {[0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = PADDING.top + chartMetrics.innerHeight * (1 - ratio)
          const valueMs = Math.round(chartMetrics.maxUsedMs * ratio)
          return (
            <g key={ratio}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={CHART_WIDTH - PADDING.right}
                y2={y}
                className="activityGridLine"
              />
              <text x={PADDING.left - 8} y={y + 4} className="activityAxisLabel" textAnchor="end">
                {formatDurationMs(valueMs)}
              </text>
            </g>
          )
        })}

        {data.map((point, index) => {
          const x = PADDING.left + chartMetrics.step * index + (chartMetrics.step - chartMetrics.barWidth) / 2
          const heightRatio = chartMetrics.maxUsedMs === 0 ? 0 : point.usedMs / chartMetrics.maxUsedMs
          const barHeight = Math.max(2, chartMetrics.innerHeight * heightRatio)
          const y = PADDING.top + chartMetrics.innerHeight - barHeight
          const showLabel = index % 5 === 0 || index === data.length - 1

          return (
            <g
              key={point.dateKey}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex((prev) => (prev === index ? null : prev))}
            >
              <rect
                x={x}
                y={y}
                width={chartMetrics.barWidth}
                height={barHeight}
                rx={4}
                className={`activityBar ${hoveredIndex === index ? 'isHovered' : ''} ${point.usedMs === 0 ? 'isEmpty' : ''}`}
              />
              {showLabel && (
                <text
                  x={x + chartMetrics.barWidth / 2}
                  y={CHART_HEIGHT - 10}
                  textAnchor="middle"
                  className="activityDateLabel"
                >
                  {point.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {hoveredPoint && (
        <div className="activityTooltip">
          <strong>{hoveredPoint.label}</strong>
          <span>{formatDurationMs(hoveredPoint.usedMs)}</span>
          <span>{hoveredPoint.openCount} opens</span>
        </div>
      )}
    </div>
  )
}
