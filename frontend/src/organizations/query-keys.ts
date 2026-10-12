export const organizationKeys = {
  list: (accountId: string) => ['organizations', accountId] as const,
  scope: (accountId: string, id: string) => ['organization', accountId, id] as const,
  context: (accountId: string, id: string) => ['organization', accountId, id, 'context'] as const,
};
