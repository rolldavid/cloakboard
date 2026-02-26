import { useEffect, useState } from 'react';

interface VoteGaugeProps {
  agreeVotes: number;
  disagreeVotes: number;
  totalVotes: number;
  animate?: boolean;
}

/**
 * Animated semicircular gauge showing agree vs disagree.
 * Center (needle pointing up) = 50/50. Left = disagree, right = agree.
 */
export function VoteGauge({ agreeVotes, disagreeVotes, totalVotes, animate = true }: VoteGaugeProps) {
  const [mounted, setMounted] = useState(!animate);

  useEffect(() => {
    if (animate) {
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }
  }, [animate]);

  // agreePercent: 0 = all disagree, 100 = all agree, 50 = even
  const agreePercent = totalVotes > 0
    ? (agreeVotes / totalVotes) * 100
    : 50;

  // Needle rotation: -90deg = far left (0% agree), 0deg = center (50%), +90deg = far right (100% agree)
  const needleAngle = mounted ? (agreePercent - 50) * 1.8 : 0;

  // Arc parameters
  const cx = 120;
  const cy = 110;
  const r = 90;

  // Generate the arc background segments
  const arcPath = (startAngle: number, endAngle: number) => {
    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, endAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 240 130" className="w-full max-w-[280px]">
        {/* Background arc track */}
        <path
          d={arcPath(180, 360)}
          fill="none"
          stroke="currentColor"
          className="text-background-tertiary"
          strokeWidth="18"
          strokeLinecap="round"
        />

        {/* Disagree arc (left half) — red */}
        <path
          d={arcPath(180, 270)}
          fill="none"
          className="text-status-error/30"
          stroke="currentColor"
          strokeWidth="18"
          strokeLinecap="round"
        />

        {/* Agree arc (right half) — green */}
        <path
          d={arcPath(270, 360)}
          fill="none"
          className="text-status-success/30"
          stroke="currentColor"
          strokeWidth="18"
          strokeLinecap="round"
        />

        {/* Active fill — disagree portion */}
        {totalVotes > 0 && disagreeVotes > 0 && (
          <path
            d={arcPath(180, 180 + Math.min((disagreeVotes / totalVotes) * 180, 180))}
            fill="none"
            className="text-status-error"
            stroke="currentColor"
            strokeWidth="18"
            strokeLinecap="round"
            style={{
              transition: mounted ? 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
            }}
          />
        )}

        {/* Active fill — agree portion */}
        {totalVotes > 0 && agreeVotes > 0 && (
          <path
            d={arcPath(360 - Math.min((agreeVotes / totalVotes) * 180, 180), 360)}
            fill="none"
            className="text-status-success"
            stroke="currentColor"
            strokeWidth="18"
            strokeLinecap="round"
            style={{
              transition: mounted ? 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
            }}
          />
        )}

        {/* Center tick mark at 50% */}
        <line
          x1={cx} y1={cy - r + 20}
          x2={cx} y2={cy - r - 2}
          stroke="currentColor"
          className="text-foreground-muted"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Needle */}
        <g
          style={{
            transform: `rotate(${needleAngle}deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            transition: mounted ? 'transform 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
          }}
        >
          <line
            x1={cx} y1={cy}
            x2={cx} y2={cy - r + 24}
            stroke="currentColor"
            className="text-foreground"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="5" fill="currentColor" className="text-foreground" />
        </g>

        {/* Labels */}
        <text x="24" y={cy + 20} className="fill-status-error text-[11px] font-medium" textAnchor="start">
          Disagree
        </text>
        <text x="216" y={cy + 20} className="fill-status-success text-[11px] font-medium" textAnchor="end">
          Agree
        </text>
      </svg>

      {/* Stats below gauge */}
      <div className="flex items-center justify-between w-full max-w-[280px] -mt-2">
        <div className="text-center">
          <span className="text-lg font-bold text-status-error">
            {totalVotes > 0 ? Math.round((disagreeVotes / totalVotes) * 100) : 0}%
          </span>
        </div>
        <div className="text-center">
          <span className="text-sm text-foreground-muted font-medium">
            {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="text-center">
          <span className="text-lg font-bold text-status-success">
            {totalVotes > 0 ? Math.round((agreeVotes / totalVotes) * 100) : 0}%
          </span>
        </div>
      </div>
    </div>
  );
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}
