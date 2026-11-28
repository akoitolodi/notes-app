/**
 * AppNavShell — Lightweight 4-Tab Navigation Bar (mobile bottom frosted bar / wide-screen left rail).
 * Kept small with only 4 icons so cold-start bundle remains minimal.
 */
import { FileText, BookOpen, Calendar, Wrench } from 'lucide-react';

const TABS = [
  { id: 'notes', label: 'Notes', Icon: FileText },
  { id: 'courses', label: 'Courses', Icon: BookOpen },
  { id: 'planner', label: 'Planner', Icon: Calendar },
  { id: 'tools', label: 'Tools', Icon: Wrench },
];

export default function AppNavShell({
  activeTab = 'notes',
  isWide = false,
  unreadAnnCount = 0,
  dueCount = 0,
  onSelectTab,
}) {
  return (
    <nav
      className={isWide ? 'app-nav-rail' : 'app-nav-bar'}
      aria-label="Primary app navigation"
    >
      {TABS.map(({ id, label, Icon }) => {
        const isActive = activeTab === id;
        const badgeCount =
          id === 'planner' ? unreadAnnCount : id === 'courses' ? dueCount : 0;
        return (
          <button
            key={id}
            type="button"
            className={`app-nav-btn${isActive ? ' active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelectTab?.(id)}
          >
            <span className="app-nav-icon-wrap">
              <Icon size={20} strokeWidth={isActive ? 2.3 : 1.9} />
              {badgeCount > 0 && (
                <span className="app-nav-badge" aria-label={`${badgeCount} unread`}>
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              )}
            </span>
            <span className="app-nav-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
