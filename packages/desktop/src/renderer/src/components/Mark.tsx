interface MarkProps {
  size?: number;
  /** Small drops the leaf veins and thickens the ring, for 32px and below. */
  variant?: "full" | "small";
  className?: string;
}

/** The Mentem mark: twin leaves inside a pomodoro. Colors come from the active theme. */
export function Mark({ size = 160, variant = "full", className }: MarkProps) {
  const full = variant === "full";
  const ring = full ? 5.5 : 9;
  const r = full ? 38 : 37;
  const gx = full ? 3 : 5;
  const sc = full ? 0.8 : 0.88;
  const left = `M${50 - gx} 79C${30 - gx} 79 ${20 - gx} 63 ${22 - gx} 48C${24 - gx} 32 ${36 - gx} 21 ${50 - gx} 24Z`;
  const right = `M${50 + gx} 79C${70 + gx} 79 ${80 + gx} 63 ${78 + gx} 48C${76 + gx} 32 ${64 + gx} 21 ${50 + gx} 24Z`;
  const T = (x: number, y: number) => `${(50 + (x - 50) * 0.8).toFixed(2)} ${(56 + (y - 50) * 0.8).toFixed(2)}`;
  const veins = [
    [44, 66, 32, 53],
    [44, 54, 35, 44],
  ]
    .map(([a, b, c, d]) => `M${T(a!, b!)}L${T(c!, d!)}M${T(100 - a!, b!)}L${T(100 - c!, d!)}`)
    .join("");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true">
      <circle cx="50" cy="56" r={r} stroke="var(--accent-subtle)" strokeWidth={ring} />
      <path d={`M50 ${56 - r}A${r} ${r} 0 1 1 ${50 - r} 56`} stroke="var(--accent)" strokeWidth={ring} strokeLinecap="round" />
      <path d="M50 17C46 5 35 0 23 2C25 14 36 22 50 17Z" fill="var(--accent)" />
      <path d="M50 17C54 9 63 5 75 7C73 16 63 21 50 17Z" fill="var(--text)" />
      <g transform={`translate(50 56) scale(${sc}) translate(-50 -50)`}>
        <path d={left} fill="var(--accent)" />
        <path d={right} fill="var(--text)" />
      </g>
      {full && <path d={veins} stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}
