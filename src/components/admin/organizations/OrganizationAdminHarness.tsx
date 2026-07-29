import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  OrganizationAdminWorkspace,
  OrganizationContext,
} from '@/lib/organizations/applicationContracts';
import type { OrganizationAdminAdapter } from '@/lib/organizations/adminAdapters';
import { canRenderOrganizationAdminHarness } from '@/lib/organizations/featureFlags';

interface OrganizationAdminHarnessProps {
  context: OrganizationContext;
  adapter: OrganizationAdminAdapter;
  mode?: 'production' | 'test-harness';
}

export function OrganizationAdminHarness({
  context,
  adapter,
  mode = 'production',
}: OrganizationAdminHarnessProps) {
  const enabled = canRenderOrganizationAdminHarness(mode);
  const [workspace, setWorkspace] =
    useState<OrganizationAdminWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    adapter
      .loadWorkspace(context)
      .then((value) => {
        if (current) setWorkspace(value);
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(reason instanceof Error ? reason.message : 'load_failed');
        }
      });
    return () => {
      current = false;
    };
  }, [adapter, context, enabled]);

  if (!enabled) return null;
  if (error) return <p role="alert">{error}</p>;
  if (!workspace) return <p>Loading organization workspace…</p>;

  const inactive = context.organization.status !== 'active';

  return (
    <section aria-label="Organization administration test harness" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{context.organization.name}</h2>
        <Badge variant={inactive ? 'secondary' : 'default'}>
          {context.organization.status}
        </Badge>
        <Badge variant="outline">{context.membership.role}</Badge>
        <Button disabled aria-label="Organization switching unavailable">
          Switch organization
        </Button>
        <span className="text-sm text-muted-foreground">
          Switching remains disabled until tenant runtime adoption.
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <WorkspaceCard title="Organization settings">
          <label className="block text-sm">
            Display name
            <input
              className="mt-1 w-full rounded border p-2"
              value={workspace.settings.displayName}
              readOnly
            />
          </label>
          <p>Timezone: {workspace.settings.timezone}</p>
          <Button disabled={inactive}>Save settings</Button>
        </WorkspaceCard>

        <WorkspaceCard title="Memberships">
          {workspace.memberships.length === 0 ? (
            <p>No active memberships.</p>
          ) : (
            workspace.memberships.map((membership) => (
              <p key={membership.userId}>
                {membership.userId} — {membership.role}
              </p>
            ))
          )}
          <Button disabled={inactive}>Add member</Button>
        </WorkspaceCard>

        <WorkspaceCard title="Service areas">
          {workspace.territories.length === 0 ? (
            <p>No active service areas. Traffic remains inactive.</p>
          ) : (
            workspace.territories.map((territory) => (
              <p key={territory.id}>
                {territory.label}: {territory.mode} {territory.value}
              </p>
            ))
          )}
          <Button disabled>Edit service areas</Button>
        </WorkspaceCard>

        <WorkspaceCard title="Service availability">
          {workspace.services.length === 0 ? (
            <p>No services available.</p>
          ) : (
            workspace.services.map((service) => (
              <p key={service.serviceKey}>
                {service.displayName}: {service.available ? 'available' : 'unavailable'}
              </p>
            ))
          )}
          <Button disabled>Edit availability</Button>
        </WorkspaceCard>

        <WorkspaceCard title="Communication contacts">
          {workspace.contacts.length === 0 ? (
            <p>No contacts configured.</p>
          ) : (
            workspace.contacts.map((contact) => (
              <p key={contact.id}>
                {contact.label} — {contact.purpose}
              </p>
            ))
          )}
        </WorkspaceCard>
      </div>
    </section>
  );
}

function WorkspaceCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
