import type { Tenant, Member } from "./model.js";
export type PlatformTenant = Tenant & {
  members: number;
  activeMembers: number;
  administrators: number;
  customers: number;
  vehicles: number;
  orders: number;
};
export type PlatformActivity = {
  id: string;
  tenantId: string;
  tenantName: string;
  actor: string;
  action: string;
  date: string;
  target?: string;
};
export type PlatformOverview = {
  tenants: PlatformTenant[];
  totalTenants: number;
  activeTenants: number;
  nextCursor: string | null;
  activity: PlatformActivity[];
  refreshedAt: string;
};
export type PlatformTeam = {
  members: Member[];
  customers: { id: string; name: string }[];
};
