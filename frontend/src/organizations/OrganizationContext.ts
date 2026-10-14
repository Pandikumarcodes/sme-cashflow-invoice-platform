import { createContext, useContext } from 'react';
import type { Organization } from './contracts';
import type { Permission } from './permissions';
export type OrganizationStatus =
  'loading' | 'ready' | 'empty' | 'error' | 'inaccessible' | 'forbidden';
export type OrganizationContextValue = {
  status: OrganizationStatus;
  organizations: Organization[];
  selectedId?: string;
  organization?: Organization;
  membership?: Organization['membership'];
  permissions: readonly Permission[];
  hasPermission: (permission: string) => boolean;
  switchOrganization: (id: string) => void;
  activateCreatedOrganization: (id: string, signal: AbortSignal) => Promise<void>;
  retry: () => void;
  clearSelection: () => void;
};
export const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);
export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) throw new Error('Organization context requires an authenticated workspace.');
  return context;
}
export function usePermissions() {
  const { status, hasPermission } = useOrganization();
  return { loading: status === 'loading', hasPermission };
}
