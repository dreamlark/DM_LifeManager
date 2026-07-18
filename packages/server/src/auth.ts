// M1 鉴权核心 —— 密码哈希 + JWT（access/refresh）
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { store } from './store';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
const ACCESS_TTL = '15m';
const REFRESH_TTL_LONG_MS = 1000 * 60 * 60 * 24 * 30; // 30 天（勾选"记住我"）
const REFRESH_TTL_SHORT_MS = 1000 * 60 * 60 * 24; // 1 天（未勾选）

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function signAccess(userId: string): string {
  return jwt.sign({ sub: userId, typ: 'access' }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

/** 解析 access token，返回 userId；失败抛错 */
export function verifyAccess(token: string): string {
  const payload = jwt.verify(token, JWT_SECRET) as { sub: string; typ?: string };
  if (payload.typ && payload.typ !== 'access') throw new Error('invalid token type');
  return payload.sub;
}

/** 登录/注册后签发双令牌，并落库 refresh session */
export async function issueSession(
  userId: string,
  rememberMe = true,
): Promise<{ accessToken: string; refreshToken: string }> {
  const ttl = rememberMe ? REFRESH_TTL_LONG_MS : REFRESH_TTL_SHORT_MS;
  const refreshToken = randomUUID();
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  await store.createSession({ userId, refreshToken, expiresAt });
  return { accessToken: signAccess(userId), refreshToken };
}

/** 用 refresh token 旋转出新的一组令牌；无效/过期则抛错 */
export async function rotateRefresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const session = await store.getSession(refreshToken);
  if (!session) throw new Error('invalid refresh token');
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await store.deleteSession(refreshToken);
    throw new Error('refresh token expired');
  }
  await store.deleteSession(refreshToken);
  return issueSession(session.userId);
}
