import { organizationIdPattern } from './contracts';
export const selectionKey = (accountId: string) => `sme.organization.${accountId}`;
export function readSelection(accountId: string) {
  try {
    const id = localStorage.getItem(selectionKey(accountId));
    return id && organizationIdPattern.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
export function saveSelection(accountId: string, id?: string) {
  try {
    if (id) localStorage.setItem(selectionKey(accountId), id);
    else localStorage.removeItem(selectionKey(accountId));
  } catch {
    /* Selection still works when browser storage is unavailable. */
  }
}
