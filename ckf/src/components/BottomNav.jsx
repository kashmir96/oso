import { NavLink } from 'react-router-dom';

const items = [
  { to: '/', label: 'Home', icon: '◯' },
  { to: '/today', label: 'Today', icon: '◐' },
  { to: '/chat', label: 'Chat', icon: '◍' },
  { to: '/weekly', label: 'Week', icon: '☷' },
  { to: '/settings', label: 'More', icon: '⋯' },
];

export default function BottomNav() {
  return (
    <nav className="nav-bottom">
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
