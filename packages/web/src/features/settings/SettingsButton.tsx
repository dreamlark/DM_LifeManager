import { Settings } from 'lucide-react';

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="设置"
      className="flex h-8 items-center gap-1.5 rounded-lg border border-bg-border bg-bg-raised px-2.5 text-xs text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
    >
      <Settings size={15} />
      <span>设置</span>
    </button>
  );
}
