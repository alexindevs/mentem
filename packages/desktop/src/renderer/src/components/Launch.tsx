import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Mark } from "./Mark";

const WIDTH = 1280;
const HEIGHT = 800;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2 - 35;
const RADIUS = 165;
const easing = [0.16, 1, 0.3, 1] as const;
const LAUNCH_DURATION = 5000;
const EXIT_DURATION = 300;

type Trace = { path: string; terminal: [number, number]; delay: number };

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function makeTraces(): Trace[] {
  const traces: Array<Omit<Trace, "delay">> = [];
  const top = [
    [-110, 100],
    [-55, 70],
    [0, 40],
    [55, 70],
    [110, 100],
  ] as const;
  for (const [dx, run] of top) {
    const x = CENTER_X + dx;
    const y = CENTER_Y - Math.sqrt(RADIUS ** 2 - dx ** 2);
    const elbowY = y - run;
    const edgeX = bounded(x + Math.sign(dx) * elbowY, 0, WIDTH);
    traces.push({ path: `M ${edgeX} 0 L ${x} ${elbowY} L ${x} ${y}`, terminal: [x, y] });
  }
  for (const [dx, run] of [
    [-105, 90],
    [105, 90],
  ] as const) {
    const x = CENTER_X + dx;
    const y = CENTER_Y + Math.sqrt(RADIUS ** 2 - dx ** 2);
    const elbowY = y + run;
    const edgeX = bounded(x + (dx < 0 ? -((HEIGHT - elbowY)) : HEIGHT - elbowY), 0, WIDTH);
    traces.push({ path: `M ${edgeX} ${HEIGHT} L ${x} ${elbowY} L ${x} ${y}`, terminal: [x, y] });
  }
  for (const side of [-1, 1] as const) {
    for (const [dy, run] of [
      [-75, 90],
      [0, 60],
      [75, 90],
    ] as const) {
      const x = CENTER_X + side * Math.sqrt(RADIUS ** 2 - dy ** 2);
      const y = CENTER_Y + dy;
      const elbowX = x + side * run;
      const edgeY = bounded(y + Math.sign(dy) * Math.abs(elbowX - (side < 0 ? 0 : WIDTH)), 0, HEIGHT);
      traces.push({ path: `M ${side < 0 ? 0 : WIDTH} ${edgeY} L ${elbowX} ${y} L ${x} ${y}`, terminal: [x, y] });
    }
  }
  return traces.map((trace, index) => ({ ...trace, delay: 0.15 + index * 0.05 }));
}

const traces = makeTraces();

interface LaunchProps {
  name: string;
  onComplete(): void;
}

export function Launch({ name, onComplete }: LaunchProps) {
  const reducedMotion = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const finish = useCallback(() => {
    setLeaving((current) => {
      if (!current) window.setTimeout(onComplete, EXIT_DURATION);
      return true;
    });
  }, [onComplete]);

  useEffect(() => {
    const timeout = window.setTimeout(finish, LAUNCH_DURATION - EXIT_DURATION);
    const skip = () => finish();
    window.addEventListener("keydown", skip, { once: true });
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", skip);
    };
  }, [finish, reducedMotion]);

  const logoTransition = useMemo(
    () => ({ delay: reducedMotion ? 0.1 : 1.25, duration: reducedMotion ? 0.12 : 0.7, ease: easing }),
    [reducedMotion],
  );

  return (
    <motion.main
      className="launch"
      aria-label="Mentem"
      onPointerDown={finish}
      initial={{ opacity: 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: EXIT_DURATION / 1000, ease: easing }}
    >
      <svg className="launch__traces" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {traces.map((trace) => (
          <g key={trace.path}>
            <motion.path
              d={trace.path}
              className="launch__trace"
              initial={{ pathLength: reducedMotion ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reducedMotion ? 0 : 1, delay: reducedMotion ? 0 : trace.delay, ease: easing }}
            />
            <motion.circle
              className="launch__dot"
              cx={trace.terminal[0]}
              cy={trace.terminal[1]}
              r="5"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: reducedMotion ? 0.12 : 0.18, delay: reducedMotion ? 0.08 : trace.delay + 0.86, ease: easing }}
            />
          </g>
        ))}
      </svg>
      <motion.div className="launch__identity" initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={logoTransition}>
        <Mark size={160} />
        <motion.h1 className="t-h-xl launch__name" initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...logoTransition, delay: logoTransition.delay + (reducedMotion ? 0 : 0.17) }}>
          {name}
        </motion.h1>
      </motion.div>
    </motion.main>
  );
}
