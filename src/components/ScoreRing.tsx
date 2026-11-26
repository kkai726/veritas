import { bandOf } from '../lib/types';

interface Props {
  score: number;
  size?: number;
  stroke?: number;
}

export function ScoreRing({ score, size = 116, stroke = 7 }: Props) {
  const band = bandOf(score);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, score)) / 100);

  return (
    <div className={`ring ring--${band.tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-inner">
        <span className="ring-score">{score}</span>
        <span className="ring-label">{band.label}</span>
      </div>
    </div>
  );
}
