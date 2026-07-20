import { create } from 'zustand';

/**
 * 认证状态（仅内存）。
 * 不再持久化令牌到 localStorage/sessionStorage —— 重启后恢复登录由 PIN 凭据库负责
 * （见 store/pinStore.ts：凭据经 PIN 派生密钥加密保存在本机，输 PIN 即自动登录）。
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  /** 引擎共享令牌（P0-2）：登录后由服务端下发，访问 engine（/engine/*）时携带；null 表示 engine 不要求令牌 */
  engineToken: string | null;
  user: AuthUser | null;
  setTokens: (access: string, refresh: string) => void;
  setEngineToken: (token: string | null) => void;
  setUser: (u: AuthUser) => void;
  clear: () => void;
  isAuthed: () => boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  accessToken: null,
  refreshToken: null,
  engineToken: null,
  user: null,
  setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
  setEngineToken: (token) => set({ engineToken: token }),
  setUser: (u) => set({ user: u }),
  clear: () => set({ accessToken: null, refreshToken: null, engineToken: null, user: null }),
  isAuthed: () => Boolean(get().accessToken),
}));
