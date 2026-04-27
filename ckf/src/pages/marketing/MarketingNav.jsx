import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/business/marketing',          label: 'Home',     end: true },
  { to: '/business/marketing/chat',     label: 'Chat' },
  { to: '/business/marketing/creative', label: 'Creative' },
  { to: '/business/marketing/drafts',   label: 'Drafts' },
  { to: '/business/marketing/assistant', label: 'Assistant' },
  { to: '/business/marketing/swipe',    label: 'Swipe' },
  { to: '/business/marketing/concepts', label: 'Concepts' },
  { to: '/business/marketing/ads',      label: 'Ads' },
  { to: '/business/marketing/scripts',  label: 'Scripts' },
  { to: '/business/marketing/library',  label: 'Library' },
  { to: '/business/marketing/health',   label: 'Health' },
];

export default function MarketingNav() {
  return (
    <div className="hat-row" style={{ marginBottom: 12 }}>
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => 'hat-pill' + (isActive ? ' active' : '')}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
