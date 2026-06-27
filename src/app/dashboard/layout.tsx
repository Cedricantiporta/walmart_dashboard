import Sidebar from '@/components/Sidebar';
import { PreloadTabs } from '@/components/PreloadTabs';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f9fafb' }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>{children}</main>
      <PreloadTabs />
    </div>
  );
}
