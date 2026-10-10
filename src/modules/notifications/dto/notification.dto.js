import { IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class NotificationListQueryDto {}
export class EmptyNotificationCommandDto {}
for (const field of ['limit', 'after', 'status', 'sortBy', 'sortOrder']) {
  ValidateIf((_o, value) => value !== undefined)(NotificationListQueryDto.prototype, field);
  IsString()(NotificationListQueryDto.prototype, field);
}
Matches(/^(?:[1-9]\d?|100)$/)(NotificationListQueryDto.prototype, 'limit');
MinLength(1)(NotificationListQueryDto.prototype, 'after');
MaxLength(2048)(NotificationListQueryDto.prototype, 'after');
Matches(/^[A-Za-z0-9_-]+$/)(NotificationListQueryDto.prototype, 'after');
IsIn(['UNREAD', 'READ', 'ARCHIVED'])(NotificationListQueryDto.prototype, 'status');
IsIn(['createdAt'])(NotificationListQueryDto.prototype, 'sortBy');
IsIn(['asc', 'desc'])(NotificationListQueryDto.prototype, 'sortOrder');
