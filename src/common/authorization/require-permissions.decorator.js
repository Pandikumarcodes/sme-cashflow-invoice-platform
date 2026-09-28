export const REQUIRED_PERMISSIONS = 'authorization:required-permissions';

export function RequirePermissions(...permissions) {
  return (_target, _propertyKey, descriptor) => {
    Reflect.defineMetadata(REQUIRED_PERMISSIONS, Object.freeze([...permissions]), descriptor.value);
  };
}
