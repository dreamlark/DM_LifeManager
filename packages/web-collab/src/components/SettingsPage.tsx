import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { Download, Upload, Database, Palette, Bot, Info, Lock, Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';
import { trpcLocal } from '../lib/trpcLocal';
import { useUI } from '../store/uiStore';
import { usePinStore, PIN_VALIDITY_OPTIONS } from '../store/pinStore';
import { useModeStore } from '../store/modeStore';

type Category = 'mode' | 'data' | 'appearance' | 'security' | 'agents' | 'about';

const CATEGORIES: { id: Category; label: string; icon: typeof Database }[] = [
  { id: 'mode', label: '运行模式', icon: SettingsIcon },
  { id: 'data', label: '数据', icon: Database },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'security', label: '安全', icon: Lock },
  { id: 'agents', label: '智能体', icon: Bot },
  { id: 'about', label: '关于', icon: Info },
];

const LOCK_OPTIONS = [
  { v: 0, label: '从不（仅手动锁屏）' },
  { v: 1, label: '1 分钟' },
  { v: 5, label: '5 分钟' },
  { v: 15, label: '15 分钟' },
  { v: 30, label: '30 分钟' },
  { v: 60, label: '60 分钟' },
];

const IMA_KEY = 'dm-ima-config';

function fmtBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function timestamp(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 设置子页面（个人模式）：分类标签布局，收纳非当前页面必需功能，便于后续扩展。
 * - 数据：状态卡 + 导出（下载 JSON bundle）/ 导入（文件 → 校验 → 备份 → 恢复）
 * - 外观：浅色 / 深色主题
 * - 智能体：IMA 知识库配置（本地持久化）+ 内置智能体占位（后续扩展）
 * - 关于：版本 / 数据目录 / 更新保护说明
 */
export function SettingsPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<Category>('data');
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const fontScale = useUI((s) => s.fontScale);
  const setFontScale = useUI((s) => s.setFontScale);
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  const localUtils = trpcLocal.useUtils();

  const statusQ = trpcLocal.system.dataStatus.useQuery(undefined, { enabled: open });
  const importMut = trpcLocal.system.importAll.useMutation({
    onSuccess: (res) => {
      toast.success(
        `数据导入成功（共 ${Object.values(res.imported).reduce((a, b) => a + b, 0)} 条）。备份已存至：${res.backupPath ?? '（无既有文件，无需备份）'}`,
        { duration: 8000 },
      );
      localUtils.invalidate(); // 刷新所有本地查询，让各模块立即反映导入后的数据
    },
    onError: (e) => toast.error(`导入失败：${e.message}`, { duration: 8000 }),
  });

  // —— 自定义数据目录 ——
  const [dataDirInput, setDataDirInput] = useState('');
  const [dataDirSaved, setDataDirSaved] = useState<string | null>(null);
  const setDirMut = trpcLocal.system.setCustomDataDir.useMutation({
    onSuccess: (res) => {
      setDataDirSaved(res.dataDir);
      toast.success('数据目录已更新，重启应用后生效（新目录为空且原目录有数据将自动迁移）', { duration: 8000 });
    },
    onError: (e) => toast.error(`保存失败：${e.message}`, { duration: 8000 }),
  });
  // 打开设置时，用当前数据目录预填输入框
  useEffect(() => {
    if (open && statusQ.data) setDataDirInput(statusQ.data.dataDir);
  }, [open, statusQ.data]);

  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      const bundle = await localUtils.client.system.exportAll.query();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dm-life-backup-${timestamp()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('已导出全部数据（JSON 备份文件）');
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      importMut.mutate({ bundle: parsed as Parameters<typeof importMut.mutate>[0]['bundle'] });
    } catch (e) {
      toast.error(`无法读取文件：${e instanceof Error ? e.message : 'JSON 解析失败'}`);
    }
  };

  // —— IMA 知识库配置（本地持久化，供后续 IMA 集成读取）——
  const [imaEndpoint, setImaEndpoint] = useState('');
  const [imaToken, setImaToken] = useState('');
  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(IMA_KEY);
      if (raw) {
        const c = JSON.parse(raw) as { endpoint?: string; token?: string };
        setImaEndpoint(c.endpoint ?? '');
        setImaToken(c.token ?? '');
      }
    } catch {
      /* 忽略损坏的配置 */
    }
  }, [open]);

  const saveIma = () => {
    try {
      localStorage.setItem(IMA_KEY, JSON.stringify({ endpoint: imaEndpoint.trim(), token: imaToken.trim() }));
      toast.success('IMA 知识库配置已保存到本地');
    } catch {
      toast.error('保存失败：本地存储不可用');
    }
  };

  // —— 安全（PIN 锁屏）——
  const hasPin = usePinStore((s) => s.hasPin);
  const lockDurationMin = usePinStore((s) => s.lockDurationMin);
  const setLockDuration = usePinStore((s) => s.setLockDuration);
  const pinValidityMs = usePinStore((s) => s.pinValidityMs);
  const setPinValidity = usePinStore((s) => s.setPinValidity);
  const changePin = usePinStore((s) => s.changePin);
  const removePin = usePinStore((s) => s.removePin);
  const lockNow = usePinStore((s) => s.lockNow);

  const [changeOpen, setChangeOpen] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [changeErr, setChangeErr] = useState<string | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const submitChangePin = async () => {
    setChangeErr(null);
    if (oldPin.length !== 4 || newPin.length !== 4) {
      setChangeErr('PIN 须为 4 位');
      return;
    }
    if (newPin !== confirmPin) {
      setChangeErr('两次新 PIN 不一致');
      return;
    }
    setChangeBusy(true);
    const ok = await changePin(oldPin, newPin);
    setChangeBusy(false);
    if (!ok) {
      setChangeErr('原 PIN 错误');
      return;
    }
    toast.success('PIN 已更新');
    setChangeOpen(false);
    setOldPin('');
    setNewPin('');
    setConfirmPin('');
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(560px,85vh)] w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-bg-border bg-bg-base text-fg shadow-2xl"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between border-b border-bg-border px-5 py-3">
            <Dialog.Title className="flex items-center gap-2 text-sm font-semibold text-accent">
              <SettingsIcon size={16} /> 设置
            </Dialog.Title>
            <Dialog.Close className="rounded-md px-2 py-1 text-gray-400 transition-colors hover:bg-bg-raised hover:text-fg">
              ✕
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* 分类标签 */}
            <nav className="flex w-32 shrink-0 flex-col gap-1 overflow-y-auto border-r border-bg-border p-3">
              {CATEGORIES.map((c) => {
                const Icon = c.icon;
                const active = category === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                      active ? 'bg-bg-raised text-accent' : 'text-gray-400 hover:bg-bg-raised/60 hover:text-fg'
                    }`}
                  >
                    <Icon size={15} /> {c.label}
                  </button>
                );
              })}
            </nav>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-5">
              {category === 'mode' && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-bg-border bg-bg-raised/40 p-3">
                    <div className="mb-2 flex items-center gap-2 font-semibold text-fg">
                      <SettingsIcon size={14} /> 运行模式
                    </div>
                    <p className="mb-2 text-[11px] text-gray-400">
                      个人模式：单机使用，数据仅存本机，不显示任何协作相关入口。
                      协作模式：开启后主界面顶部出现「协作」按钮、各功能页出现「共享到家庭」按钮；点击「协作」才进入家庭协作。
                    </p>
                    <div className="flex gap-3">
                      {(['local', 'collab'] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setMode(m)}
                          className={`flex-1 rounded-lg border px-4 py-3 text-sm transition-colors ${
                            mode === m
                              ? 'border-accent bg-bg-raised text-accent'
                              : 'border-bg-border text-gray-300 hover:border-accent/50'
                          }`}
                        >
                          <div className="text-base font-semibold">{m === 'local' ? '个人模式' : '协作模式'}</div>
                          <div className="mt-1 text-xs text-gray-400">
                            {m === 'local' ? '单机 · 本机数据' : '联机 · 家庭共享'}
                          </div>
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                      切换即时生效，不会自动跳转登录。开启协作模式后，点击「协作」进入家庭协作；若个人模式已登录且 PIN 库含家庭账号，将自动复用凭据免登录；首次进入家庭协作时需登录账号。
                    </p>
                  </div>
                </div>
              )}

              {category === 'data' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-400">
                    导出会把全部个人数据保存为标准 JSON 文件（含格式与版本标识）；导入会从该文件恢复数据。
                    导入前会自动备份当前库，校验失败或导入异常将回滚，数据不会丢失。
                  </p>

                  {/* 自定义数据目录 */}
                  <div className="rounded-lg border border-bg-border bg-bg-raised/40 p-3">
                    <div className="mb-2 flex items-center gap-2 font-semibold text-fg">
                      <Database size={14} /> 数据目录
                    </div>
                    <p className="mb-2 text-[11px] text-gray-400">
                      数据库的保存位置（dm-life.db）。修改后需<strong className="text-gray-300">重启应用</strong>生效；
                      若新目录为空且原目录已有数据，重启时会自动迁移，无需手动复制。
                    </p>
                    <div className="flex flex-col gap-2">
                      <input
                        value={dataDirInput}
                        onChange={(e) => {
                          setDataDirInput(e.target.value);
                          setDataDirSaved(null);
                        }}
                        placeholder="例如 D:/MyData/dm-life"
                        spellCheck={false}
                        className="w-full rounded-md border border-bg-border bg-bg-base px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setDirMut.mutate({ dir: dataDirInput })}
                          disabled={setDirMut.isPending || !dataDirInput.trim()}
                          className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                        >
                          {setDirMut.isPending ? '保存中…' : '保存目录'}
                        </button>
                        {dataDirSaved && (
                          <span className="text-[11px] text-emerald-300">已保存：{dataDirSaved}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-bg-border bg-bg-raised/40 p-3 text-xs">
                    <div className="mb-2 flex items-center gap-2 font-semibold text-fg">
                      <Database size={14} /> 数据状态
                    </div>
                    {statusQ.isLoading ? (
                      <div className="text-gray-400">读取中…</div>
                    ) : statusQ.data ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-300">
                        <span>应用版本</span>
                        <span className="text-right text-fg">{statusQ.data.appVersion}</span>
                        <span>Schema 版本</span>
                        <span className="text-right text-fg">v{statusQ.data.schemaVersion}</span>
                        <span>文件大小</span>
                        <span className="text-right text-fg">{fmtBytes(statusQ.data.fileSizeBytes)}</span>
                        <span>数据目录</span>
                        <span className="truncate text-right text-fg" title={statusQ.data.dataDir}>
                          {statusQ.data.dataDir}
                        </span>
                      </div>
                    ) : (
                      <div className="text-red-400">无法读取数据状态</div>
                    )}
                    {statusQ.data && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {Object.entries(statusQ.data.tableRowCounts).map(([t, c]) => (
                          <span
                            key={t}
                            className="rounded bg-bg-base/60 px-1.5 py-0.5 text-[11px] text-gray-400"
                            title={`${t}: ${c} 行`}
                          >
                            {t} <span className="text-accent">{c}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleExport}
                      className="flex items-center gap-1.5 rounded-md border border-bg-border bg-bg-raised px-3 py-2 text-sm text-gray-200 transition-colors hover:border-accent/50 hover:text-accent"
                    >
                      <Download size={15} /> 导出备份
                    </button>
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={importMut.isPending}
                      className="flex items-center gap-1.5 rounded-md border border-bg-border bg-bg-raised px-3 py-2 text-sm text-gray-200 transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-50"
                    >
                      <Upload size={15} /> {importMut.isPending ? '导入中…' : '从文件导入'}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleFile(f);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>
              )}

              {category === 'appearance' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-400">选择深色、浅色，或跟随系统。设置会立即生效并持久化（刷新不丢）。</p>
                  <div className="flex gap-3">
                    {(['dark', 'light', 'system'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        className={`flex-1 rounded-lg border px-4 py-5 text-sm transition-colors ${
                          theme === t
                            ? 'border-accent bg-bg-raised text-accent'
                            : 'border-bg-border text-gray-300 hover:border-accent/50'
                        }`}
                      >
                        <div className="text-base font-semibold">
                          {t === 'dark' ? '深色' : t === 'light' ? '浅色' : '跟随系统'}
                        </div>
                        <div className="mt-1 text-xs text-gray-400">
                          {t === 'dark' ? '夜间护眼' : t === 'light' ? '明亮清晰' : '自动匹配系统'}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 flex items-center gap-2 font-semibold text-fg">
                      <SettingsIcon size={14} /> 字号
                    </div>
                    <div className="flex gap-2">
                      {(['small', 'standard', 'large', 'xlarge'] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setFontScale(s)}
                          className={`flex-1 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                            fontScale === s
                              ? 'border-accent bg-bg-raised text-accent'
                              : 'border-bg-border text-gray-400 hover:border-accent/50 hover:text-fg'
                          }`}
                        >
                          <span className="text-base font-semibold">
                            {s === 'small' ? 'A' : s === 'standard' ? 'A' : s === 'large' ? 'A' : 'A'}
                          </span>
                          <div className="mt-1">
                            {s === 'small' ? '小' : s === 'standard' ? '标准' : s === 'large' ? '大' : '特大'}
                          </div>
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">调整全站字号，立即生效并持久化（刷新不丢）。</p>
                  </div>
                </div>
              )}

              {category === 'security' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-400">
                    PIN 锁屏用于保护本机数据：锁屏后只需输入 4 位 PIN 即可快速进入，
                    凭据经 PIN 派生密钥加密保存在本机，无需再次输入账号密码。
                  </p>

                  <div className="rounded-lg border border-bg-border bg-bg-raised/40 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-fg">PIN 状态</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          hasPin ? 'bg-emerald-500/15 text-emerald-300' : 'bg-bg-base/60 text-gray-400'
                        }`}
                      >
                        {hasPin ? '已设置' : '未设置'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {hasPin ? '当前已启用 PIN 锁屏。' : '尚未设置 PIN，应用将不再锁屏保护。'}
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-gray-400">空闲自动锁定时长</label>
                    <select
                      value={lockDurationMin}
                      onChange={(e) => setLockDuration(Number(e.target.value))}
                      className="w-full rounded-md border border-bg-border bg-bg-base px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                    >
                      {LOCK_OPTIONS.map((o) => (
                        <option key={o.v} value={o.v}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-gray-500">
                      超过此时长无操作将自动锁屏；选择「从不」则仅在手动锁屏时生效。
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-gray-400">PIN 凭据有效期</label>
                    <select
                      value={pinValidityMs}
                      onChange={(e) => setPinValidity(Number(e.target.value))}
                      className="w-full rounded-md border border-bg-border bg-bg-base px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                    >
                      {PIN_VALIDITY_OPTIONS.map((o) => (
                        <option key={o.ms} value={o.ms}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-gray-500">
                      凭据库将在选定时间后过期，过期后需重新输入账号密码登录（当前已保存的凭据库将在下次解锁/登录时按新有效期续期）。
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => lockNow()}
                      disabled={!hasPin}
                      className="rounded-md border border-bg-border bg-bg-raised px-3 py-2 text-sm text-gray-200 transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40"
                    >
                      立即锁定
                    </button>
                    <button
                      onClick={() => {
                        setChangeErr(null);
                        setChangeOpen((v) => !v);
                      }}
                      disabled={!hasPin}
                      className="rounded-md border border-bg-border bg-bg-raised px-3 py-2 text-sm text-gray-200 transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40"
                    >
                      修改 PIN
                    </button>
                    <button
                      onClick={() => setRemoveOpen(true)}
                      disabled={!hasPin}
                      className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40"
                    >
                      移除 PIN
                    </button>
                  </div>

                  {changeOpen && (
                    <div className="space-y-2 rounded-lg border border-bg-border bg-bg-raised/40 p-3">
                      <div className="text-xs font-semibold text-fg">修改 4 位 PIN</div>
                      <input
                        value={oldPin}
                        onChange={(e) => setOldPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="原 PIN"
                        inputMode="numeric"
                        type="password"
                        className="w-full rounded-md border border-bg-border bg-bg-base px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                      />
                      <input
                        value={newPin}
                        onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="新 PIN"
                        inputMode="numeric"
                        type="password"
                        className="w-full rounded-md border border-bg-border bg-bg-base px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                      />
                      <input
                        value={confirmPin}
                        onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="确认新 PIN"
                        inputMode="numeric"
                        type="password"
                        className="w-full rounded-md border border-bg-border bg-bg-base px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                      />
                      {changeErr && <div className="text-xs text-red-400">{changeErr}</div>}
                      <div className="flex gap-2">
                        <button
                          onClick={submitChangePin}
                          disabled={changeBusy}
                          className="rounded-md border border-accent/50 px-3 py-1.5 text-sm text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
                        >
                          {changeBusy ? '保存中…' : '保存'}
                        </button>
                        <button
                          onClick={() => {
                            setChangeOpen(false);
                            setOldPin('');
                            setNewPin('');
                            setConfirmPin('');
                            setChangeErr(null);
                          }}
                          className="rounded-md border border-bg-border px-3 py-1.5 text-sm text-gray-300 transition-colors hover:text-fg"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}

                  {removeOpen && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
                      <div className="text-sm font-semibold text-red-200">移除 PIN？</div>
                      <p className="mt-1 text-xs text-red-200/80">
                        移除后应用将不再锁屏保护。协作模式下，下次进入需重新输入账号密码登录。
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => {
                            removePin();
                            setRemoveOpen(false);
                            toast.success('已移除 PIN');
                          }}
                          className="rounded-md border border-red-500/50 bg-red-500/20 px-3 py-1.5 text-sm text-red-200 transition-colors hover:bg-red-500/30"
                        >
                          确认移除
                        </button>
                        <button
                          onClick={() => setRemoveOpen(false)}
                          className="rounded-md border border-bg-border px-3 py-1.5 text-sm text-gray-300 transition-colors hover:text-fg"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {category === 'agents' && (
                <div className="space-y-5">
                  <div className="rounded-lg border border-bg-border bg-bg-raised/40 p-3">
                    <div className="mb-2 text-sm font-semibold text-fg">IMA 知识库配置</div>
                    <p className="mb-3 text-xs text-gray-400">
                      配置 IMA（智能知识库）接入信息，供后续「笔记语义检索 / 自动归档」等智能体能力使用。
                      当前仅做本地持久化，不上传服务端。
                    </p>
                    <label className="mb-1 block text-xs text-gray-400">接口地址</label>
                    <input
                      value={imaEndpoint}
                      onChange={(e) => setImaEndpoint(e.target.value)}
                      placeholder="https://ima.example.com/api"
                      className="mb-3 w-full rounded-md border border-bg-border bg-bg-base px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                    />
                    <label className="mb-1 block text-xs text-gray-400">访问令牌</label>
                    <input
                      value={imaToken}
                      onChange={(e) => setImaToken(e.target.value)}
                      placeholder="sk-..."
                      type="password"
                      className="mb-3 w-full rounded-md border border-bg-border bg-bg-base px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                    />
                    <button
                      onClick={saveIma}
                      className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-sm text-gray-200 transition-colors hover:border-accent/50 hover:text-accent"
                    >
                      保存配置
                    </button>
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-semibold text-fg">内置智能体</div>
                    <div className="grid grid-cols-2 gap-2">
                      {['记账助手', '晨间复盘', '灵感筛选官', '压力教练'].map((name) => (
                        <div
                          key={name}
                          className="flex items-center justify-between rounded-md border border-bg-border bg-bg-raised/30 px-3 py-2 text-sm text-gray-400"
                        >
                          <span>{name}</span>
                          <span className="rounded bg-bg-base/60 px-1.5 py-0.5 text-[11px] text-gray-500">即将推出</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {category === 'about' && (
                <div className="space-y-4 text-sm">
                  <div className="text-lg font-bold text-accent">DM_life</div>
                  <p className="text-gray-300">
                    一款人生管理系统：看板、财务、提醒、灵感、心流、平衡轮一体化。
                  </p>
                  <div className="space-y-1 rounded-lg border border-bg-border bg-bg-raised/40 p-3 text-xs text-gray-300">
                    <div className="flex justify-between">
                      <span>应用版本</span>
                      <span className="text-fg">{statusQ.data?.appVersion ?? '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Schema 版本</span>
                      <span className="text-fg">v{statusQ.data?.schemaVersion ?? '—'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>数据目录</span>
                      <span className="truncate text-fg" title={statusQ.data?.dataDir}>
                        {statusQ.data?.dataDir ?? '—'}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-200">
                    <div className="mb-1 font-semibold">更新保护</div>
                    数据存放在操作系统用户数据目录（与安装目录隔离），程序更新/重装不会清空。
                    启动时按版本增量迁移旧数据结构，向后兼容；迁移失败会自动回滚并提示，绝不丢失数据。
                    你也可随时使用「数据」页的导出/导入做额外备份。
                  </div>
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
