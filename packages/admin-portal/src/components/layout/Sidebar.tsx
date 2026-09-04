import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Award,
  Building2,
  ScanLine,
  Briefcase,
  ClipboardList,
  ShieldAlert,
  AlertTriangle,
  FileBarChart,
  FolderOpen,
  BookOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useRBAC, type NavItem } from '@/hooks/useRBAC';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Users,
  Award,
  Building2,
  ScanLine,
  Briefcase,
  ClipboardList,
  ShieldAlert,
  AlertTriangle,
  FileBarChart,
  FolderOpen,
  BookOpen,
  Settings,
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { visibleNavItems } = useRBAC();

  return (
    <aside
      className={`
        flex flex-col bg-white border-r border-gray-200 transition-all duration-200
        ${collapsed ? 'w-sidebar-collapsed' : 'w-sidebar'}
      `}
    >
      {/* Logo */}
      <div className="flex items-center h-header px-4 border-b border-gray-200">
        {!collapsed && (
          <span className="text-lg font-semibold text-primary-700 truncate">
            Compliance
          </span>
        )}
        <button
          onClick={onToggle}
          className="ml-auto p-1 rounded hover:bg-gray-100 text-gray-500"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4" aria-label="Main navigation">
        <ul className="space-y-1 px-2">
          {visibleNavItems.map((item) => (
            <SidebarItem key={item.path} item={item} collapsed={collapsed} />
          ))}
        </ul>
      </nav>
    </aside>
  );
}

function SidebarItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = ICON_MAP[item.icon];

  return (
    <li>
      <NavLink
        to={item.path}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors
          ${isActive
            ? 'bg-primary-50 text-primary-700'
            : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
          }
          ${collapsed ? 'justify-center' : ''}`
        }
        title={collapsed ? item.label : undefined}
      >
        {Icon && <Icon className="h-5 w-5 flex-shrink-0" />}
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    </li>
  );
}
