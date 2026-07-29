import type {
  OrganizationContext,
  OrganizationScopedRecord,
} from './applicationContracts';

export interface TenantDataSource<T extends OrganizationScopedRecord> {
  listByOrganizationId(organizationId: string): Promise<readonly T[]>;
}

export class OrganizationLineageError extends Error {
  constructor() {
    super('organization_lineage_mismatch');
  }
}

export async function listForOrganization<
  T extends OrganizationScopedRecord,
>(
  context: OrganizationContext,
  source: TenantDataSource<T>,
): Promise<readonly T[]> {
  const records = await source.listByOrganizationId(context.organization.id);
  if (
    records.some(
      (record) => record.organizationId !== context.organization.id,
    )
  ) {
    throw new OrganizationLineageError();
  }
  return records;
}
