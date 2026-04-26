import { NavLink } from 'react-router-dom';

const items = [
  { to: '/', label: 'Home', icon: '◯' },
  { to: '/business', label: 'Business', icon: '◧' },
  { to: '/today', label: 'Routine', icon: '◐' },
  { to: '/settings', label: 'Settings', icon: '⋯' },
];

export default function BottomNav() {
  return (
    <nav className="nav-bottom nav-bottom-4">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.to === '/'}
          className={({ isActive }) => (isActive ? 'active' : '')}
        >
          <span className="icon">{it.icon}</span>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}
