export function toMembershipResponse(membership) {
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    role: membership.role,
    status: membership.status,
    organizationTitle: membership.organizationTitle,
    joinedAt: membership.joinedAt,
    suspendedAt: membership.suspendedAt,
    removedAt: membership.removedAt,
    version: membership.version,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
    ...(membership.user
      ? {
          user: {
            id: membership.user.id,
            email: membership.user.email,
            firstName: membership.user.firstName,
            lastName: membership.user.lastName,
            status: membership.user.status,
          },
        }
      : {}),
  };
}

export function toInvitationResponse(invitation, deliveryToken) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    invitedByUserId: invitation.invitedByUserId,
    acceptedByUserId: invitation.acceptedByUserId,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
    updatedAt: invitation.updatedAt,
    ...(deliveryToken ? { delivery: { mode: 'DEVELOPMENT', token: deliveryToken } } : {}),
  };
}
