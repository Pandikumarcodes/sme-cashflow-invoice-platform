import { IsIn, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class AuditListQueryDto {}
const proto = AuditListQueryDto.prototype;
for (const field of [
  'limit',
  'after',
  'sortBy',
  'sortOrder',
  'actorUserId',
  'action',
  'entityType',
  'entityId',
  'occurredFrom',
  'occurredTo',
]) {
  ValidateIf((_o, value) => value !== undefined)(proto, field);
  IsString()(proto, field);
}
Matches(/^(?:[1-9]\d?|100)$/)(proto, 'limit');
MinLength(1)(proto, 'after');
MaxLength(2048)(proto, 'after');
Matches(/^[A-Za-z0-9_-]+$/)(proto, 'after');
IsIn(['occurredAt'])(proto, 'sortBy');
IsIn(['asc', 'desc'])(proto, 'sortOrder');
for (const field of ['actorUserId', 'entityId']) IsUUID()(proto, field);
for (const [field, max] of [
  ['action', 100],
  ['entityType', 50],
]) {
  MinLength(1)(proto, field);
  MaxLength(max)(proto, field);
}
for (const field of ['occurredFrom', 'occurredTo']) Matches(/^\d{4}-\d{2}-\d{2}$/)(proto, field);
