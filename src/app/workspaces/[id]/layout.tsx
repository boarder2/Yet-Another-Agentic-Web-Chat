import { Metadata } from 'next';
import WorkspaceShell from '@/components/Workspaces/WorkspaceShell';
import { getWorkspace } from '@/lib/workspaces/service';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const workspace = await getWorkspace(id);
  if (!workspace?.name) return {};
  return { title: `${workspace.name} - YAAWC` };
}

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkspaceShell workspaceId={id}>{children}</WorkspaceShell>;
}
