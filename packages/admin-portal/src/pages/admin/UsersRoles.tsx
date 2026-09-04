import { useState, useMemo } from 'react';
import { useApiQuery, useApiMutation, useInvalidateQueries } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Shield } from 'lucide-react';
import { useForm } from 'react-hook-form';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'inactive' | 'invited';
  lastLogin: string | null;
  createdAt: string;
}

interface UsersResponse {
  users: User[];
  total: number;
}

interface InviteFormData {
  email: string;
  name: string;
  role: string;
}

const statusVariants = {
  active: 'success' as const,
  inactive: 'default' as const,
  invited: 'info' as const,
};

const roleLabels: Record<string, string> = {
  platform_admin: 'Platform Admin',
  tenant_admin: 'Tenant Admin',
  site_admin: 'Site Admin',
  supervisor: 'Supervisor',
  cso: 'CSO',
  gate_operator: 'Gate Operator',
};

export default function UsersRoles() {
  const [search, setSearch] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const invalidate = useInvalidateQueries();

  const { data, isLoading } = useApiQuery<UsersResponse>(
    ['admin', 'users', search],
    '/admin/users',
    search ? { search } : undefined
  );

  const { register, handleSubmit, reset, formState: { errors } } = useForm<InviteFormData>();

  const { mutate: invite, isPending } = useApiMutation<void, InviteFormData>(
    'post',
    '/admin/users/invite',
    {
      onSuccess: () => {
        invalidate([['admin', 'users']]);
        setShowInvite(false);
        reset();
      },
    }
  );

  const columns: ColumnDef<User, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
      },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ getValue }) => (
          <Badge variant="purple">{roleLabels[getValue() as string] ?? (getValue() as string)}</Badge>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => {
          const status = getValue() as User['status'];
          return <Badge variant={statusVariants[status]}>{status}</Badge>;
        },
      },
      {
        accessorKey: 'lastLogin',
        header: 'Last Login',
        cell: ({ getValue }) => {
          const val = getValue() as string | null;
          return val ? new Date(val).toLocaleDateString() : <span className="text-gray-400">Never</span>;
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Users & Roles</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} users in the platform
          </p>
        </div>
        <Button size="sm" onClick={() => setShowInvite(true)}>
          <Plus size={16} />
          Invite User
        </Button>
      </div>

      <div className="w-full sm:w-72">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search users..."
        />
      </div>

      <DataTable
        data={data?.users ?? []}
        columns={columns}
        pageSize={15}
        emptyMessage={isLoading ? 'Loading...' : 'No users found'}
      />

      <Modal open={showInvite} onClose={() => setShowInvite(false)} title="Invite User">
        <form onSubmit={handleSubmit((d) => invite(d))} className="space-y-4">
          <Input
            label="Name"
            {...register('name', { required: 'Name is required' })}
            error={errors.name?.message}
            placeholder="Full name"
          />
          <Input
            label="Email"
            type="email"
            {...register('email', { required: 'Email is required' })}
            error={errors.email?.message}
            placeholder="user@company.com"
          />
          <Select
            label="Role"
            options={[
              { value: 'tenant_admin', label: 'Tenant Admin' },
              { value: 'site_admin', label: 'Site Admin' },
              { value: 'supervisor', label: 'Supervisor' },
              { value: 'cso', label: 'CSO' },
              { value: 'gate_operator', label: 'Gate Operator' },
            ]}
            placeholder="Select role"
            {...register('role', { required: 'Role is required' })}
            error={errors.role?.message}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowInvite(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Sending...' : 'Send Invite'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
