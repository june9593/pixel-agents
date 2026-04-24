interface ProgressBarProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  color?: 'brand' | 'success' | 'warning' | 'error';
  showLabel?: boolean;
}

const colorClasses = {
  brand: 'bg-indigo-600',
  success: 'bg-emerald-600',
  warning: 'bg-amber-500',
  error: 'bg-red-600',
};

const sizeClasses = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
};

function getAutoColor(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= 80) return 'success';
  if (pct >= 60) return 'warning';
  return 'error';
}

export function ProgressBar({ value, max = 100, size = 'md', color, showLabel = false }: ProgressBarProps) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const resolvedColor = color ?? getAutoColor(pct);

  return (
    <div className="flex items-center gap-3">
      <div className={`flex-1 bg-slate-100 rounded-full overflow-hidden ${sizeClasses[size]}`}>
        <div
          className={`${colorClasses[resolvedColor]} h-full rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
      {showLabel && <span className="text-sm font-semibold text-slate-700 tabular-nums w-10 text-right">{pct}%</span>}
    </div>
  );
}
