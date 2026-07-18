import type { Role } from '@dm-life/server';

export type Permission =
  | 'viewShared'
  | 'createTask'
  | 'editTask'
  | 'createEvent'
  | 'editEvent'
  | 'manageMembers'
  | 'viewFinance'
  | 'manageFinance'
  | 'manageFamily';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['viewShared', 'createTask', 'editTask', 'createEvent', 'editEvent', 'manageMembers', 'viewFinance', 'manageFinance', 'manageFamily'],
  admin: ['viewShared', 'createTask', 'editTask', 'createEvent', 'editEvent', 'manageMembers', 'viewFinance', 'manageFinance'],
  member: ['viewShared', 'createTask', 'editTask', 'createEvent', 'editEvent', 'viewFinance'],
  child: ['viewShared', 'createTask', 'createEvent'],
  guest: ['viewShared'],
};

export function can(role: Role | null, perm: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(perm);
}

/** 可被邀请/指派的非 owner 角色（owner 只能转让，不能指派） */
export const ASSIGNABLE_ROLES: Role[] = ['admin', 'member', 'child', 'guest'];
