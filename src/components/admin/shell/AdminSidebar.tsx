import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  Inbox,
  ClipboardList,
  Phone,
  BarChart3,
  Users,
  Plug,
  DollarSign,
  ShieldCheck,
  MessageSquare,
  BookOpen,
  Mail,
  FileBarChart,
  LayoutDashboard,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export type AdminSection =
  | "overview"
  | "inbox"
  | "ops"
  | "conversations"
  | "bookings"
  | "scheduling"
  | "analytics"
  | "crew"
  | "integrations"
  | "pricing"
  | "security"
  | "knowledge"
  | "email-drafts"
  | "reports";

type Item = { key: AdminSection; title: string; icon: typeof Activity; badge?: number };

const primary: Item[] = [
  { key: "overview", title: "Overview", icon: LayoutDashboard },
  { key: "inbox", title: "Action Inbox", icon: Inbox },
  { key: "conversations", title: "Conversations", icon: MessageSquare },
  { key: "ops", title: "Ops", icon: Activity },
];

const operations: Item[] = [
  { key: "bookings", title: "Bookings", icon: ClipboardList },
  { key: "scheduling", title: "Scheduling", icon: Phone },
  { key: "crew", title: "Crew", icon: Users },
];

const growth: Item[] = [
  { key: "analytics", title: "Analytics", icon: BarChart3 },
  { key: "reports", title: "Reports", icon: FileBarChart },
  { key: "email-drafts", title: "Email Drafts", icon: Mail },
];

const config: Item[] = [
  { key: "integrations", title: "Integrations", icon: Plug },
  { key: "pricing", title: "Pricing", icon: DollarSign },
  { key: "security", title: "Security", icon: ShieldCheck },
];

interface Props {
  active: AdminSection;
  onSelect: (section: AdminSection) => void;
  inboxCount?: number;
}

export function AdminSidebar({ active, onSelect, inboxCount }: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();

  const renderGroup = (label: string, items: Item[]) => (
    <SidebarGroup>
      {!collapsed && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = active === item.key;
            const showBadge = item.key === "inbox" && inboxCount && inboxCount > 0;
            return (
              <SidebarMenuItem key={item.key}>
                <SidebarMenuButton
                  isActive={isActive}
                  onClick={() => onSelect(item.key)}
                  className="flex items-center gap-2"
                >
                  <item.icon className="h-4 w-4" />
                  {!collapsed && <span className="flex-1 text-left">{item.title}</span>}
                  {!collapsed && showBadge ? (
                    <span className="ml-auto rounded-full bg-primary/15 text-primary text-xs px-2 py-0.5 font-medium">
                      {inboxCount}
                    </span>
                  ) : null}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {renderGroup("Command Center", primary)}
        {renderGroup("Operations", operations)}
        {renderGroup("Growth", growth)}
        {renderGroup("Configuration", config)}
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Knowledge</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith("/admin/knowledge")}>
                  <NavLink to="/admin/knowledge" className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    {!collapsed && <span>Knowledge Base</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}