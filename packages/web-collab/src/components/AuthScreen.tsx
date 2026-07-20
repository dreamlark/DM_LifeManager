import { useState } from 'react';
import { trpc, refreshEngineToken } from '../lib/trpc';
import { useAuthStore } from '../store/authStore';
import { usePinStore } from '../store/pinStore';
import { FloatingIcon } from './FloatingIcon';

type Mode = 'login' | 'register';

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const openSetup = usePinStore((s) => s.openSetup);
  const hasPin = usePinStore((s) => s.hasPin);
  const expired = usePinStore((s) => s.expired);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        const r = await trpc.auth.register.mutate({ name, email, password });
        setTokens(r.accessToken, r.refreshToken);
        setUser(r.user);
      } else {
        const r = await trpc.auth.login.mutate({ email, password });
        setTokens(r.accessToken, r.refreshToken);
        setUser(r.user);
      }
      await refreshEngineToken();
      // 首次登录（无 PIN 库）或凭据过期（库存在但超期）→ 引导设置/重设 PIN。
      // 凭据经 PIN 加密保存在本机，有效期内重启只需输 PIN；过期则再次回到本登录页。
      if (!hasPin || expired) openSetup({ email, password }, hasPin);
      onAuthed();
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card glass">
        <div className="brand">
          <FloatingIcon icon="🏡" tone="indigo" size="lg" />
          <h1>家庭协作</h1>
          <p className="brand-sub">DM Life · 联机版</p>
        </div>

        <div className="seg">
          <button
            className={mode === 'login' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setMode('login')}
            type="button"
          >
            登录
          </button>
          <button
            className={mode === 'register' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setMode('register')}
            type="button"
          >
            注册
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <label className="field">
              <span>昵称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="你的名字" required />
            </label>
          )}
          <label className="field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@home.dev"
              required
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              minLength={6}
              required
            />
          </label>

          {error && <div className="form-error">{error}</div>}

          <button className="btn-primary magnetic" disabled={busy} type="submit">
            {busy ? '处理中…' : mode === 'register' ? '创建账号' : '进入'}
          </button>
        </form>

        <p className="auth-tip">
          {mode === 'register'
            ? '注册即创建你自己的家庭，随后可邀请家人加入'
            : '登录后管理你的家庭与成员'}
        </p>
      </div>
    </div>
  );
}

function extractMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return '操作失败，请重试';
}
