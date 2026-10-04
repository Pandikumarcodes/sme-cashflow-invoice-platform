import { IsIn, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { MONEY_PATTERN } from '../../../common/money/decimal.js';
import { PAYMENT_METHODS } from '../domain/payment-policy.js';

export class RecordPaymentDto {
  @IsString()
  @Matches(MONEY_PATTERN)
  amount;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paymentDate;

  @IsIn(PAYMENT_METHODS)
  method;
}

export class ReversePaymentDto {
  @IsString()
  @MaxLength(500)
  @Matches(/\S/)
  reason;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  reversalDate;
}

export class PaymentListQueryDto {}
const optional = () => ValidateIf((_object, value) => value !== undefined);
function rules(field, validators) {
  for (const validator of [optional(), ...validators])
    validator(PaymentListQueryDto.prototype, field);
}
rules('invoiceId', [IsUUID('4')]);
rules('status', [IsIn(['RECORDED', 'REVERSED'])]);
rules('method', [IsIn(PAYMENT_METHODS)]);
rules('sortBy', [IsIn(['paymentDate', 'recordedAt', 'amount'])]);
rules('sortOrder', [IsIn(['asc', 'desc'])]);
rules('limit', [IsString(), Matches(/^(?:[1-9]\d?|100)$/)]);
rules('after', [IsString(), MinLength(1), MaxLength(2048), Matches(/^[A-Za-z0-9_-]+$/)]);
for (const field of ['paymentDateFrom', 'paymentDateTo'])
  rules(field, [IsString(), Matches(/^\d{4}-\d{2}-\d{2}$/)]);
