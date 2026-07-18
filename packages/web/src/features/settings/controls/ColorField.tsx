interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

export function ColorField({ label, value, onChange }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-fg">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-gray-500">{value.toUpperCase()}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded-lg border border-bg-border bg-bg-raised p-0.5"
        />
      </div>
    </div>
  );
}
