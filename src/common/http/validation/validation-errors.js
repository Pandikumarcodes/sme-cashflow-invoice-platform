export function normalizeValidationErrors(errors, parentPath = '') {
  return errors.flatMap((error) => {
    const field = parentPath.length > 0 ? `${parentPath}.${error.property}` : error.property;
    const ownErrors = Object.values(error.constraints ?? {}).map((message) => ({
      field,
      code: 'INVALID_FIELD',
      message,
    }));
    return [...ownErrors, ...normalizeValidationErrors(error.children ?? [], field)];
  });
}
