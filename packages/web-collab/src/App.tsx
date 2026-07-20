import { useCallback, useEffect, useState } from 'react';
import { trpc, refreshEngineToken } from './lib/trpc';
import { connectRealtime, disconnectRealtime } from './lib/realtime';
import { useAuthStore } from './store/authStore';
import { useFamilyStore } from './store/familyStore';
import { useModeStore } from './store/modeStore';
import { usePinStore, hasValidVault, type PinCreds } from './store/pinStore';
import { AppLock } from './components/AppLock';
import LocalApp from './LocalApp';
import { AuthScreen } from './components/AuthScreen';
import { AcceptInvite } from './components/AcceptInvite';
import { FamilyBoard } from './components/FamilyBoard';
import { CalendarPage } from './components/CalendarPage';
import { FamilyFinanceBoard } from './features/finance/FamilyFinanceBoard';
import { FamilySharedHub } from './features/shared/FamilySharedHub';
import { ThemeToggle } from './components/ThemeToggle';
import { Toaster } from 'sonner';
import { useUI, applyTheme, applyFontScale } from './store/uiStore';
import { FloatingIcon } from './components/FloatingIcon';
import { VersionBanner } from './components/VersionBanner';

type View = 'auth' | 'accept' | 'board';
type BoardTab = 'members' | 'calendar' | 'finance' | 'shared';

export default function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setUser = useAuthStore((s) => s.setUser);
  const setTokens = useAuthStore((s) => s.setTokens);
  const clearAuth = useAuthStore((s) => s.clear);
  const user = useAuthStore((s) => s.user);

  const setFamilies = useFamilyStore((s) => s.setFamilies);
  const setMembers = useFamilyStore((s) => s.setMembers);
  const resetFamily = useFamilyStore((s) => s.reset);
  const currentFamilyId = useFamilyStore((s) => s.currentFamilyId);

  const mode = useModeStore((s) => s.mode);

  const hasPin = usePinStore((s) => s.hasPin);
  const expired = usePinStore((s) => s.expired);
  const openSetup = usePinStore((s) => s.openSetup);

  // 进入阶段判定：
  // - 本地模式：无需账号密码，交给 PIN 锁屏（或首次/过期时设置 PIN）。
  // - 协作模式：有“有效”的 PIN 库 → 交给 PIN 锁屏解锁；无库（首次）或库已过期 → 显示账号密码登录。
  const [view, setView] = useState<View>(() => {
    const ps = usePinStore.getState();
    if (useModeStore.getState().mode === 'local') return 'board';
    if (ps.hasPin && !ps.expired) return 'board';
    return 'auth';
  });
  const [tab, setTab] = useState<BoardTab>('members');
  const [loading, setLoading] = useState(true);
  // 协作视图导航态（独立于 mode）：默认在个人功能壳（LocalApp），
  // 仅当用户主动点击「协作」入口时才进入家庭协作视图。
  const [familyOpen, setFamilyOpen] = useState(false);

  // 本地模式：首次（无 PIN 库）或凭据过期（库存在但超期）→ 引导设置/重设 PIN。
  // 用 hasValidVault() 判定，避免设置完成后落入“再次弹出设置”的循环。
  // 注意：切换运行模式（local/collab）只改变“是否显示协作入口”，不再强制跳转登录；
  // 家庭协作的登录只发生在「点击协作按钮」或「PIN 解锁时自动带出家庭凭据」两种场景。
  useEffect(() => {
    const ps = usePinStore.getState();
    if (mode === 'local' && !ps.setupOpen && !hasValidVault()) openSetup({ local: true }, ps.hasPin);
  }, [mode, hasPin, expired, openSetup]);

  // 启动：自动重连——有令牌则补取用户信息并加载家庭列表；access 缺失时尝试用 refresh 旋转恢复。
  // 已设置 PIN 时跳过服务端引导：锁屏后用 PIN 解密凭据自动登录。
  const bootstrap = useCallback(async () => {
    if (useModeStore.getState().mode === 'local') {
      setLoading(false);
      return;
    }
    if (usePinStore.getState().hasPin) {
      setLoading(false);
      return;
    }
    const { accessToken: at, refreshToken: rt } = useAuthStore.getState();
    if (!at && !rt) {
      setLoading(false);
      return;
    }
    try {
      if (!at && rt) {
        const r = await trpc.auth.refresh.mutate({ refreshToken: rt });
        useAuthStore.getState().setTokens(r.accessToken, r.refreshToken);
      }
      const me = await trpc.auth.me.query();
      setUser(me);
      await refreshEngineToken();
      const list = await trpc.families.list.query();
      setFamilies(list);
      setView('board');
    } catch {
      clearAuth();
      resetFamily();
      setView('auth');
    } finally {
      setLoading(false);
    }
  }, [setUser, setFamilies, setMembers, clearAuth, resetFamily]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // 主题应用（统一）：个人视图与家庭协作视图都由 App 顶层统一应用，
  // 单一真相来自 uiStore.theme（含 system）。跟随系统时监听系统配色变化实时切换。
  const theme = useUI((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // 字号档位应用（与主题同级的单一入口）：切换时立即改写 <html data-font-scale>，
  // 由 styles.css 的 html[data-font-scale] 选择器驱动根字号，全站 rem 文本等比缩放。
  const fontScale = useUI((s) => s.fontScale);
  useEffect(() => {
    applyFontScale(fontScale);
  }, [fontScale]);

  // 实时网关：已登录且进入家庭看板时建立 WS 连接；退出登录或回到个人视图时断开
  useEffect(() => {
    if (familyOpen && accessToken && view === 'board') connectRealtime();
    else disconnectRealtime();
  }, [familyOpen, accessToken, view]);

  const onAuthed = useCallback(async () => {
    try {
      const list = await trpc.families.list.query();
      setFamilies(list);
      if (list.length > 0) {
        const cur = list[0]!;
        const ms = await trpc.families.members.query({ familyId: cur.id });
        setMembers(ms);
      }
      setView('board');
    } catch {
      setView('board');
    }
  }, [setFamilies, setMembers]);

  const onJoined = useCallback(async () => {
    const list = await trpc.families.list.query();
    setFamilies(list);
    if (list.length > 0) {
      const cur = list[0]!;
      const ms = await trpc.families.members.query({ familyId: cur.id });
      setMembers(ms);
    }
    setView('board');
  }, [setFamilies, setMembers]);

  // PIN 解锁成功：
  // - 个人模式无需服务端凭据，直接放行（PIN 仅作本机锁屏），切换模式不触发重认证。
  // - 协作模式尽力用解密出的邮箱/密码自动登录家庭；若库里没有协作凭据（纯个人用户首次开启协作）
  //   或本次自动登录失败，仍放行进入个人功能——家庭协作的登录改为「点击协作入口」时按需进行，
  //   绝不因缺家庭凭据而返回 false 导致 AppLock 误删 PIN 库。
  const onUnlock = useCallback(
    async (creds: PinCreds): Promise<boolean> => {
      if (useModeStore.getState().mode === 'local') return true;
      if (creds.email && creds.password) {
        try {
          const r = await trpc.auth.login.mutate({ email: creds.email, password: creds.password });
          setTokens(r.accessToken, r.refreshToken);
          setUser(r.user);
          await refreshEngineToken();
          await onAuthed();
        } catch {
          /* 自动登录失败：放行进入个人功能，家庭协作登录在点击协作入口时进行 */
        }
      }
      return true;
    },
    [setTokens, setUser, onAuthed],
  );

  // 忘记 PIN：清空凭据库；协作模式导向家庭登录视图（登录后会引导重设 PIN 落库家庭凭据），
  // 个人模式由下方 setup 副作用自动重新引导设置 PIN，无需在此处理。
  const onForgotPin = useCallback(() => {
    clearAuth();
    resetFamily();
    if (useModeStore.getState().mode === 'collab') {
      setFamilyOpen(true);
      setView('auth');
    }
  }, [clearAuth, resetFamily, setFamilyOpen, setView]);

  async function logout() {
    disconnectRealtime();
    // P1-4：服务端吊销当前 refresh 会话，避免令牌在本地被清后仍可被复用
    try {
      await trpc.auth.logout.mutate({ refreshToken: useAuthStore.getState().refreshToken ?? undefined });
    } catch {
      /* 吊销失败不阻塞登出（本地清理仍进行） */
    }
    clearAuth();
    resetFamily();
    setFamilyOpen(false);
    // 已设 PIN 则进入锁屏（输 PIN 可重新进入）；未设 PIN 回到个人功能
    if (usePinStore.getState().hasPin) usePinStore.getState().lockNow();
  }

  if (loading) {
    return (
      <div className="boot">
        <div className="spinner" />
      </div>
    );
  }

  const content = (() => {
    // 家庭协作视图：仅当用户主动点击「协作」入口（familyOpen）时进入。
    // 未登录或显式回到登录时展示 AuthScreen；否则展示家庭看板。
    if (familyOpen) {
      if (view === 'accept') {
        return <AcceptInvite onJoined={onJoined} onCancel={() => setFamilyOpen(false)} />;
      }
      if (!accessToken || view === 'auth') {
        return <AuthScreen onAuthed={onAuthed} />;
      }
      return (
        <div className="app-shell">
          <VersionBanner />
          <div className="topbar glass">
            <div className="topbar-left">
              <FloatingIcon icon="🏡" tone="emerald" size="sm" />
              <span className="app-name">家庭协作</span>
              <button
                className="btn-ghost sm"
                type="button"
                title="返回个人功能（保留协作模式设置）"
                onClick={() => setFamilyOpen(false)}
              >
                个人
              </button>
            </div>
            <div className="topbar-right">
              {user && <span className="who">@{user.name}</span>}
              <ThemeToggle />
              <button className="icon-btn" title="接受邀请 / 加入家庭" onClick={() => setView('accept')} type="button">
                ✉️
              </button>
              <button className="btn-logout" title="锁定 / 退出登录" onClick={logout} type="button">
                <span aria-hidden="true">⏻</span> 退出
              </button>
            </div>
          </div>
          <main className="app-main">
            {currentFamilyId && (
              <div className="seg board-tabs">
                <button
                  type="button"
                  className={tab === 'members' ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setTab('members')}
                >
                  成员
                </button>
                <button
                  type="button"
                  className={tab === 'calendar' ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setTab('calendar')}
                >
                  日历
                </button>
                <button
                  type="button"
                  className={tab === 'finance' ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setTab('finance')}
                >
                  财务
                </button>
                <button
                  type="button"
                  className={tab === 'shared' ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setTab('shared')}
                >
                  共享
                </button>
              </div>
            )}
            {tab === 'members' ? (
              <FamilyBoard onLeft={() => setView('auth')} />
            ) : tab === 'finance' ? (
              <FamilyFinanceBoard />
            ) : tab === 'shared' ? (
              <FamilySharedHub />
            ) : (
              <CalendarPage />
            )}
          </main>
        </div>
      );
    }

    // 个人功能外壳（local 与 collab 模式共用）：协作模式下顶部会出现「协作」入口，
    // 点击才进入家庭协作视图；个人模式则不显示任何协作相关入口。
    return <LocalApp onOpenFamily={() => setFamilyOpen(true)} />;
  })();

  return (
    <AppLock onUnlock={onUnlock} onForgotPin={onForgotPin}>
      {content}
      <Toaster theme={theme} richColors position="top-right" />
    </AppLock>
  );
}
