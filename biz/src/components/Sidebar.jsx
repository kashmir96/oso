import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { GROUPS, agentsInGroup } from '../agents/_registry.js';

/**
 * Sidebar — left rail on desktop (≥768px), drawer on mobile via hamburger.
 * Single component, one responsive ruleset. Auto-closes on mobile after a
 * nav-click so the page is visible.
 */
export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  function navClick() {
    // Close the drawer on mobile after pick. CSS handles desktop visibility.
    if (window.matchMedia('(max-width: 767px)').matches) setOpen(false);
  }

  return (
    <>
      {/* Mobile-only top bar with just the hamburger. The chat header
          below already shows the active agent's name + icon, so we don't
          duplicate the title here. */}
      <div className="biz-mobile-bar">
        <button className="biz-hamburger" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button>
      </div>

      {/* Backdrop (mobile only when open). */}
      {open && <div className="biz-backdrop" onClick={() => setOpen(false)} />}

      <aside className={`biz-sidebar ${open ? 'biz-sidebar-open' : ''}`}>
        <div className="biz-sidebar-head">
          <div className="biz-brand">oso/biz</div>
          <button className="biz-sidebar-close" aria-label="Close menu" onClick={() => setOpen(false)}>✕</button>
        </div>

        <nav className="biz-sidebar-nav">
          {GROUPS.map((g) => (
            <div key={g.id} className="biz-group">
              <div className="biz-group-label">{g.label}</div>
              {agentsInGroup(g.id).map((a) => (
                <NavLink
                  key={a.slug}
                  to={`/${a.slug}`}
                  className={({ isActive }) => `biz-nav-item ${isActive ? 'biz-nav-active' : ''}`}
                  onClick={navClick}
                  title={a.blurb}
                >
                  <span className="biz-nav-icon">{a.icon}</span>
                  <span className="biz-nav-name">{a.name}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="biz-sidebar-foot">
          <NavLink to="/" className="biz-nav-item" onClick={navClick}>↩ Home</NavLink>
          <a href="/ckf/" className="biz-nav-item">⤴ CKF</a>
        </div>
      </aside>
    </>
  );
}

function currentTitle(path) {
  const slug = path.split('/').filter(Boolean)[0];
  if (!slug) return 'oso/biz';
  // Cheap lookup; the registry import would make this trivially exhaustive
  // but the substring match works fine for the mobile title.
  return slug.replace(/-/g, ' ');
}
