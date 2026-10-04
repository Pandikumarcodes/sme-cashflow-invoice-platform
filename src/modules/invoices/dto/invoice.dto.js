import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MONEY_PATTERN, QUANTITY_PATTERN, RATE_PATTERN } from '../../../common/money/decimal.js';

export class InvoiceItemDto {}
export class InvoiceDiscountDto {}
export class CreateInvoiceDto {}
export class UpdateInvoiceDto {}
export class InvoiceListQueryDto {}
export class IssueInvoiceDto {}
export class InvoiceReasonDto {}

function rules(target, field, validators) {
  for (const validator of validators) validator(target.prototype, field);
}
const optional = () => ValidateIf((_object, value) => value !== undefined);
rules(InvoiceItemDto, 'description', [IsString(), MaxLength(500), Matches(/\S/)]);
rules(InvoiceItemDto, 'quantity', [IsString(), Matches(QUANTITY_PATTERN)]);
rules(InvoiceItemDto, 'unitPrice', [IsString(), Matches(MONEY_PATTERN)]);
rules(InvoiceItemDto, 'sortOrder', [IsInt(), Min(0), Max(2147483647)]);
rules(InvoiceDiscountDto, 'type', [IsIn(['NONE', 'FIXED', 'PERCENTAGE'])]);
rules(InvoiceDiscountDto, 'value', [
  IsString(),
  MaxLength(22),
  Matches(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/),
]);
for (const target of [CreateInvoiceDto, UpdateInvoiceDto]) {
  const validate = (field, validators) =>
    rules(target, field, target === UpdateInvoiceDto ? [optional(), ...validators] : validators);
  validate('customerId', [IsUUID('4')]);
  validate('issueDate', [IsString(), Matches(/^\d{4}-\d{2}-\d{2}$/)]);
  validate('dueDate', [IsString(), Matches(/^\d{4}-\d{2}-\d{2}$/)]);
  validate('taxRate', [IsString(), Matches(RATE_PATTERN)]);
  validate('discount', [IsObject(), ValidateNested(), Type(() => InvoiceDiscountDto)]);
  validate('items', [
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(1000),
    ValidateNested({ each: true }),
    Type(() => InvoiceItemDto),
  ]);
}
rules(InvoiceReasonDto, 'reason', [IsString(), MaxLength(500), Matches(/\S/)]);
for (const [field, values] of [
  ['status', ['DRAFT', 'ISSUED', 'CANCELLED', 'VOID']],
  ['paymentState', ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'NOT_APPLICABLE']],
  ['overdue', ['true', 'false']],
  ['sortBy', ['issueDate', 'dueDate', 'createdAt', 'total', 'invoiceNumber']],
  ['sortOrder', ['asc', 'desc']],
])
  rules(InvoiceListQueryDto, field, [optional(), IsString(), IsIn(values)]);
rules(InvoiceListQueryDto, 'customerId', [optional(), IsUUID('4')]);
rules(InvoiceListQueryDto, 'limit', [optional(), IsString(), Matches(/^(?:[1-9]\d?|100)$/)]);
rules(InvoiceListQueryDto, 'after', [
  optional(),
  IsString(),
  MinLength(1),
  MaxLength(2048),
  Matches(/^[A-Za-z0-9_-]+$/),
]);
rules(InvoiceListQueryDto, 'search', [
  optional(),
  IsString(),
  MinLength(2),
  MaxLength(100),
  Matches(/\S/),
]);
for (const field of ['issueDateFrom', 'issueDateTo', 'dueDateFrom', 'dueDateTo'])
  rules(InvoiceListQueryDto, field, [optional(), IsString(), Matches(/^\d{4}-\d{2}-\d{2}$/)]);
