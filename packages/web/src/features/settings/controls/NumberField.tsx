interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}

export function NumberField({ label, value, min, max, step = 1, suffix, onChange }: Props) {
  const clamp = (n: number) => {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-fg">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(clamp(value - step))}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-raised text-gray-300 transition-colors hover:text-fg"
        >
          −
        </button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="w-14 rounded-lg border border-bg-border bg-bg-raised px-2 py-1 text-center text-sm text-fg outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + step))}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-raised text-gray-300 transition-colors hover:text-fg"
        >
          +
        </button>
        {suffix ? <span className="w-10 text-xs text-gray-500">{suffix}</span> : null}
      </div>
    </div>
  );
}
