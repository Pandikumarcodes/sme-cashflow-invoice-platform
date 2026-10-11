import { Allow, IsIn, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { MONEY_PATTERN } from '../../../common/money/decimal.js';

export class CreateCategoryDto {
  name;
  description;
}
export class UpdateCategoryDto {
  name;
  description;
}
export class ArchiveCategoryDto {}
export class CreateExpenseDto {
  categoryId;
  vendorPayee;
  amount;
  expenseDate;
  description;
  reference;
  notes;
}
export class UpdateExpenseDto {
  categoryId;
  vendorPayee;
  amount;
  expenseDate;
  description;
  reference;
  notes;
}
export class VoidExpenseDto {
  reason;
}
export class CategoryListQueryDto {
  limit;
  after;
  status;
}
export class ExpenseListQueryDto {
  limit;
  after;
  status;
  categoryId;
  expenseDateFrom;
  expenseDateTo;
  vendor;
  sortBy;
  sortOrder;
}

const optional = (dto, field, nullable = false) =>
  ValidateIf((_object, value) => value !== undefined && (!nullable || value !== null))(
    dto.prototype,
    field,
  );
const text = (dto, field, maximum) => {
  IsString()(dto.prototype, field);
  Matches(/\S/)(dto.prototype, field);
  if (maximum) MaxLength(maximum)(dto.prototype, field);
};
for (const dto of [CreateCategoryDto, UpdateCategoryDto]) {
  text(dto, 'name');
  text(dto, 'description', 500);
  optional(dto, 'description');
  if (dto === UpdateCategoryDto) optional(dto, 'name');
}
for (const dto of [CreateExpenseDto, UpdateExpenseDto]) {
  IsUUID('4')(dto.prototype, 'categoryId');
  IsString()(dto.prototype, 'amount');
  Matches(MONEY_PATTERN)(dto.prototype, 'amount');
  IsString()(dto.prototype, 'expenseDate');
  Matches(/^\d{4}-\d{2}-\d{2}$/)(dto.prototype, 'expenseDate');
  for (const [field, max] of [
    ['description', 500],
    ['vendorPayee', 200],
    ['reference', 150],
    ['notes', 1000],
  ]) {
    text(dto, field, max);
    if (field !== 'description') optional(dto, field, true);
  }
  if (dto === UpdateExpenseDto)
    for (const field of ['categoryId', 'amount', 'expenseDate', 'description'])
      optional(dto, field);
}
text(VoidExpenseDto, 'reason', 500);
for (const dto of [CategoryListQueryDto, ExpenseListQueryDto]) {
  for (const field of ['limit', 'status']) {
    optional(dto, field);
    IsString()(dto.prototype, field);
  }
  Matches(/^(?:[1-9]\d?|100)$/)(dto.prototype, 'limit');
  // Decode cursor in the application so all invalid cursor forms share INVALID_CURSOR.
  optional(dto, 'after');
  Allow()(dto.prototype, 'after');
  IsIn(dto === CategoryListQueryDto ? ['ACTIVE', 'ARCHIVED'] : ['ACTIVE', 'VOIDED'])(
    dto.prototype,
    'status',
  );
}
for (const field of [
  'categoryId',
  'expenseDateFrom',
  'expenseDateTo',
  'vendor',
  'sortBy',
  'sortOrder',
])
  optional(ExpenseListQueryDto, field);
IsUUID('4')(ExpenseListQueryDto.prototype, 'categoryId');
for (const field of ['expenseDateFrom', 'expenseDateTo']) {
  IsString()(ExpenseListQueryDto.prototype, field);
  Matches(/^\d{4}-\d{2}-\d{2}$/)(ExpenseListQueryDto.prototype, field);
}
text(ExpenseListQueryDto, 'vendor', 200);
IsIn(['expenseDate', 'createdAt', 'amount', 'vendorPayee'])(
  ExpenseListQueryDto.prototype,
  'sortBy',
);
IsIn(['asc', 'desc'])(ExpenseListQueryDto.prototype, 'sortOrder');
