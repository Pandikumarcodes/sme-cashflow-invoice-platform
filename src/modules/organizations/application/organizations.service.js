import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { DEFAULT_EXPENSE_CATEGORIES } from '../domain/organization-defaults.js';
import { assertBaseCurrencyChangeAllowed } from '../domain/organization-policy.js';
import {
  isSupportedCurrency,
  isValidLocale,
  isValidTimezone,
  normalizeCurrency,
  normalizeInvoicePrefix,
  normalizeSlug,
} from '../domain/organization-settings.js';
import { toOrganizationResponse, toOrganizationSummary } from '../organization-response.js';

const MUTABLE_FIELDS = [
  'legalName',
  'displayName',
  'slug',
  'baseCurrency',
  'timezone',
  'locale',
  'invoicePrefix',
  'invoiceNumberPadding',
  'defaultPaymentTermsDays',
];

@Injectable()
export class OrganizationsService {
  constructor(prismaService, authorization) {
    this.prismaService = prismaService;
    this.authorization = authorization;
  }

  async create(auth, input, metadata = {}) {
    const prisma = await this.prismaService.getClient();
    const now = new Date();
    this.assertRegistryValues(input);
    const data = this.normalizeCreate(input);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({ data });
        await tx.invoiceSequence.create({ data: { organizationId: organization.id } });
        await tx.expenseCategory.createMany({
          data: DEFAULT_EXPENSE_CATEGORIES.map((category) => ({
            organizationId: organization.id,
            ...category,
          })),
        });
        const membership = await tx.membership.create({
          data: {
            organizationId: organization.id,
            userId: auth.userId,
            role: 'OWNER',
            status: 'ACTIVE',
            joinedAt: now,
          },
        });
        await this.audit(tx, {
          organizationId: organization.id,
          actorUserId: auth.userId,
          actorMembershipId: membership.id,
          actorSessionId: auth.sessionId,
          action: 'ORGANIZATION_CREATED',
          entityId: organization.id,
          afterData: this.auditData(organization, MUTABLE_FIELDS),
          ...metadata,
        });
        return { organization, membership };
      });
      return toOrganizationResponse(result.organization, result.membership);
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ApplicationError(
          ERROR_CODES.ORGANIZATION_SLUG_UNAVAILABLE,
          'Organization slug is unavailable.',
        );
      }
      throw error;
    }
  }

  async list(auth) {
    const prisma = await this.prismaService.getClient();
    const memberships = await prisma.membership.findMany({
      where: {
        userId: auth.userId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      include: { organization: true },
      orderBy: [{ organization: { createdAt: 'asc' } }, { id: 'asc' }],
    });
    return memberships.map(toOrganizationSummary);
  }

  async get(auth, organizationId) {
    const prisma = await this.prismaService.getClient();
    const membership = await this.findMembership(prisma, auth.userId, organizationId);
    this.assertOrganizationAvailable(membership);
    this.authorization.assertPermission(membership.role, PERMISSIONS.ORGANIZATION_READ);
    return toOrganizationResponse(membership.organization, membership);
  }

  async update(auth, organizationId, expectedVersion, input, metadata = {}) {
    const prisma = await this.prismaService.getClient();
    this.assertRegistryValues(input);
    const normalized = this.normalizeUpdate(input);
    if (Object.keys(normalized).length === 0) {
      throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'At least one setting is required.');
    }
    try {
      const result = await prisma.$transaction(async (tx) => {
        const membership = await this.findMembership(tx, auth.userId, organizationId);
        this.assertOrganizationAvailable(membership);
        this.authorization.assertPermission(membership.role, PERMISSIONS.ORGANIZATION_UPDATE);
        if (!assertBaseCurrencyChangeAllowed(membership.organization, normalized.baseCurrency)) {
          throw new ApplicationError(
            ERROR_CODES.CURRENCY_LOCKED,
            'Base currency cannot change after financial activity begins.',
          );
        }
        const changed = await tx.organization.updateMany({
          where: { id: organizationId, status: 'ACTIVE', version: expectedVersion },
          data: { ...normalized, version: { increment: 1 } },
        });
        if (changed.count !== 1) {
          throw new ApplicationError(
            ERROR_CODES.CONCURRENT_MODIFICATION,
            'Organization version does not match.',
          );
        }
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: organizationId },
        });
        const fields = Object.keys(normalized);
        await this.audit(tx, {
          organizationId,
          actorUserId: auth.userId,
          actorMembershipId: membership.id,
          actorSessionId: auth.sessionId,
          action: 'ORGANIZATION_UPDATED',
          entityId: organizationId,
          changedFields: fields,
          beforeData: this.auditData(membership.organization, fields),
          afterData: this.auditData(organization, fields),
          ...metadata,
        });
        return { organization, membership };
      });
      return toOrganizationResponse(result.organization, result.membership);
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ApplicationError(
          ERROR_CODES.ORGANIZATION_SLUG_UNAVAILABLE,
          'Organization slug is unavailable.',
        );
      }
      throw error;
    }
  }

  async close(auth, organizationId, reason, metadata = {}) {
    const prisma = await this.prismaService.getClient();
    const result = await prisma.$transaction(async (tx) => {
      const membership = await this.findMembership(tx, auth.userId, organizationId);
      this.assertOrganizationAvailable(membership);
      this.authorization.assertPermission(membership.role, PERMISSIONS.ORGANIZATION_CLOSE);
      const changed = await tx.organization.updateMany({
        where: { id: organizationId, status: 'ACTIVE', version: membership.organization.version },
        data: { status: 'CLOSED', version: { increment: 1 } },
      });
      if (changed.count !== 1) {
        throw new ApplicationError(
          ERROR_CODES.CONCURRENT_MODIFICATION,
          'Organization changed while it was being closed.',
        );
      }
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
      });
      await this.audit(tx, {
        organizationId,
        actorUserId: auth.userId,
        actorMembershipId: membership.id,
        actorSessionId: auth.sessionId,
        action: 'ORGANIZATION_CLOSED',
        entityId: organizationId,
        changedFields: ['status'],
        beforeData: { status: 'ACTIVE' },
        afterData: { status: 'CLOSED' },
        metadata: { reason: reason.trim() },
        ...metadata,
      });
      return { organization, membership };
    });
    return toOrganizationResponse(result.organization, result.membership);
  }

  findMembership(prisma, userId, organizationId) {
    return prisma.membership.findFirst({
      where: { userId, organizationId, status: 'ACTIVE' },
      include: { organization: true },
    });
  }

  assertOrganizationAvailable(membership) {
    if (!membership) {
      throw new ApplicationError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Organization not found.');
    }
    if (membership.organization.status !== 'ACTIVE') {
      throw new ApplicationError(
        ERROR_CODES.INVALID_ORGANIZATION_STATUS,
        'Organization is not active.',
      );
    }
  }

  normalizeCreate(input) {
    const legalName = input.legalName.trim();
    return {
      legalName,
      displayName: input.displayName?.trim() ?? legalName,
      baseCurrency: normalizeCurrency(input.baseCurrency),
      timezone: input.timezone.trim(),
      ...(input.slug === undefined ? {} : { slug: normalizeSlug(input.slug) }),
      ...(input.locale === undefined ? {} : { locale: input.locale.trim() }),
      ...(input.invoicePrefix === undefined
        ? {}
        : { invoicePrefix: normalizeInvoicePrefix(input.invoicePrefix) }),
      ...(input.invoiceNumberPadding === undefined
        ? {}
        : { invoiceNumberPadding: input.invoiceNumberPadding }),
      ...(input.defaultPaymentTermsDays === undefined
        ? {}
        : { defaultPaymentTermsDays: input.defaultPaymentTermsDays }),
    };
  }

  assertRegistryValues(input) {
    if (input.baseCurrency !== undefined && !isSupportedCurrency(input.baseCurrency)) {
      throw new ApplicationError(ERROR_CODES.INVALID_CURRENCY, 'Base currency is not supported.');
    }
    if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
      throw new ApplicationError(ERROR_CODES.INVALID_TIMEZONE, 'Timezone is not valid.');
    }
    if (input.locale !== undefined && !isValidLocale(input.locale)) {
      throw new ApplicationError(ERROR_CODES.INVALID_LOCALE, 'Locale is not valid.');
    }
  }

  normalizeUpdate(input) {
    const data = {};
    for (const field of MUTABLE_FIELDS) {
      if (input[field] !== undefined) data[field] = input[field];
    }
    for (const field of ['legalName', 'displayName', 'timezone', 'locale']) {
      if (data[field] !== undefined) data[field] = data[field].trim();
    }
    if (data.slug !== undefined) data.slug = normalizeSlug(data.slug);
    if (data.baseCurrency !== undefined) data.baseCurrency = normalizeCurrency(data.baseCurrency);
    if (data.invoicePrefix !== undefined) {
      data.invoicePrefix = normalizeInvoicePrefix(data.invoicePrefix);
    }
    return data;
  }

  auditData(entity, fields) {
    return Object.fromEntries(fields.map((field) => [field, entity[field]]));
  }

  audit(tx, event) {
    return tx.auditLog.create({
      data: {
        organizationId: event.organizationId,
        actorType: 'USER',
        actorUserId: event.actorUserId,
        actorMembershipId: event.actorMembershipId,
        actorSessionId: event.actorSessionId,
        action: event.action,
        entityType: 'Organization',
        entityId: event.entityId,
        outcome: 'SUCCESS',
        changedFields: event.changedFields,
        beforeData: event.beforeData,
        afterData: event.afterData,
        metadata: event.metadata,
        requestId: event.requestId,
        correlationId: event.correlationId,
        source: 'API',
      },
    });
  }
}
Inject(PrismaService)(OrganizationsService, undefined, 0);
Inject(AuthorizationService)(OrganizationsService, undefined, 1);
