import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../errors/application-error.js';
import { ERROR_CODES } from '../errors/error-codes.js';
import { ALL_PERMISSIONS } from './permissions.js';
import { ROLE_PERMISSIONS } from './role-permissions.js';

@Injectable()
export class AuthorizationService {
  permissionsFor(role) {
    return ROLE_PERMISSIONS.get(role) ?? new Set();
  }

  can(role, permission) {
    return ALL_PERMISSIONS.includes(permission) && this.permissionsFor(role).has(permission);
  }

  canAll(role, permissions) {
    return (
      Array.isArray(permissions) && permissions.every((permission) => this.can(role, permission))
    );
  }

  assertPermission(role, permission) {
    if (!this.can(role, permission)) {
      throw new ApplicationError(ERROR_CODES.FORBIDDEN, 'Permission is not granted.');
    }
  }
}
