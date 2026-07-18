import { useEffect, useState, type ReactNode } from 'react';
import { useModeStore } from '../store/modeStore';

/**
 * 后端就绪守卫：在渲染应用前先探测本地 engine（/engine/_routes）
 * 与协作服务（/health）。
 *
 * - engine 就绪后本地模式立即可用；
 * - 协作服务（PGLite）可能仍需 10-30s 预热，未就绪时显示进度并允许切换到个人模式；
 * - 全部就绪后自动渲染 <App/>，无需手动刷新。
 *
 * 配合 start-dm-life.bat 的顺序启动（engine 就绪后开浏览器、server 后台预热），
 * 可把「浏览器窗口出现」压缩到几秒，同时避免协作服务未就绪时进入应用导致 Failed to fetch。
 */
export function BackendGate({ children }: { children: ReactNode }) {
  const [engineReady, setEngineReady] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [dots, setDots] = useState(0);
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const checkEngine = async () => {
      try {
        const res = await fetch('/engine/_routes', { cache: 'no-store' });
        if (res.ok && alive) setEngineReady(true);
      } catch {
        /* engine 尚未启动 */
      }
    };

    const checkServer = async () => {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok && alive) setServerReady(true);
      } catch {
        /* server 尚未监听或仍在预热 */
      }
    };

    const tick = () => {
      void checkEngine();
      void checkServer();
      setDots((d) => (d + 1) % 4);
    };

    tick();
    timer = setInterval(tick, 1500);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  // 本地模式：engine 就绪即可进入
  if (mode === 'local' && engineReady) return <>{children}</>;

  // 协作模式：engine + server 都就绪才进入，避免 /trpc 请求失败
  if (mode === 'collab' && engineReady && serverReady) return <>{children}</>;

  // 等待态
  const waitingServer = engineReady && !serverReady && mode === 'collab';
  const waitingEngine = !engineReady;

  return (
    <div className="boot">
      <div className="connecting-card">
        <div className="spinner" />
        <p className="connecting-title">正在连接后端服务</p>
        <div className="connecting-hint space-y-2 text-left">
          <div className="flex items-center gap-2">
            <span className={engineReady ? 'text-green-400' : 'text-gray-400'}>
              {engineReady ? '✅' : '⏳'}
            </span>
            <span>本地引擎 {engineReady ? '已就绪' : '启动中…'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={serverReady ? 'text-green-400' : 'text-gray-400'}>
              {serverReady ? '✅' : '⏳'}
            </span>
            <span>协作服务 {serverReady ? '已就绪' : '正在初始化数据库（约 10-30 秒）…'}</span>
          </div>
          <p className="text-xs text-gray-500">
            {waitingEngine
              ? '首次启动需初始化本地数据库，就绪后将自动进入，无需手动刷新。'
              : waitingServer
                ? '协作服务在后台预热，请稍候；或先切换到个人模式使用本地功能。'
                : '正在完成启动…'}
            {' .'.repeat(dots)}
          </p>
        </div>
        {waitingServer && (
          <button
            type="button"
            className="btn-ghost mt-4 text-xs"
            onClick={() => setMode('local')}
          >
            先使用个人模式
          </button>
        )}
      </div>
    </div>
  );
}
