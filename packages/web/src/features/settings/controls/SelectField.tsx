interface Option {
  value: string | number;
  label: string;
}

interface Props {
  label: string;
  value: string | number;
  options: Option[];
  onChange: (v: string | number) => void;
}

export function SelectField({ label, value, options, onChange }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-fg">{label}</span>
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const opt = options.find((o) => String(o.value) === raw);
          onChange(opt ? opt.value : raw);
        }}
        className="rounded-lg border border-bg-border bg-bg-raised px-3 py-1.5 text-sm text-fg outline-none transition-colors focus:border-accent"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
