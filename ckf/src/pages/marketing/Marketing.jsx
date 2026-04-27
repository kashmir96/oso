import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { call } from '../../lib/api.js';
import Home from './Home.jsx';
import CampaignDetail from './CampaignDetail.jsx';
import Concepts from './Concepts.jsx';
import ConceptDetail from './ConceptDetail.jsx';
import Ads from './Ads.jsx';
import AdDetail from './AdDetail.jsx';
import Scripts from './Scripts.jsx';
import ScriptDetail from './ScriptDetail.jsx';
import Library from './Library.jsx';
import Chat from './Chat.jsx';
import Memory from './Memory.jsx';
import SwipeFile from './SwipeFile.jsx';
import Wizard from './Wizard.jsx';
import Drafts from './Drafts.jsx';
import Assistant from './Assistant.jsx';
import Creative from './Creative.jsx';
import Health from './Health.jsx';

// Lazy-loaded entry-point — everything in /pages/marketing/* lives in this
// chunk and is only fetched when the user opens /business/marketing.
export default function Marketing() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="campaigns/:id" element={<CampaignDetail />} />
      <Route path="concepts" element={<Concepts />} />
      <Route path="concepts/:id" element={<ConceptDetail />} />
      <Route path="ads" element={<Ads />} />
      <Route path="ads/:ad_id" element={<AdDetail />} />
      <Route path="scripts" element={<Scripts />} />
      <Route path="scripts/:id" element={<ScriptDetail />} />
      <Route path="library" element={<Library />} />
      <Route path="chat" element={<Chat />} />
      <Route path="chat/:id" element={<Chat />} />
      <Route path="memory" element={<Memory />} />
      <Route path="swipe" element={<SwipeFile />} />
      <Route path="drafts" element={<Drafts />} />
      <Route path="assistant" element={<Assistant />} />
      {/* New creative-agent pipeline (Block 5). Replaces the old wizard once
          we cut over (legacy routes above stay until then.) */}
      <Route path="creative" element={<Creative />} />
      <Route path="creative/:id" element={<Creative />} />
      {/* System health -- proposals queue + audit memos + token cost (Block 7). */}
      <Route path="health" element={<Health />} />
      {/* New ad creation is a chat, not a form. /wizard (no id) spawns a
          fresh marketing chat in ad-creation mode. /wizard/:id stays as the
          editable review surface for an existing draft (used by the chat's
          ready-to-paste card's "Edit & submit" link). */}
      <Route path="wizard" element={<NewAdRedirect />} />
      <Route path="wizard/:id" element={<Wizard />} />
      <Route path="*" element={<Navigate to="" replace />} />
    </Routes>
  );
}

// Spawns a fresh marketing chat in create_ad mode and replaces the URL
// with the chat. The AI's first message is the wizard's first question.
function NewAdRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const conv = await call('mktg-chat', { action: 'create_conversation', kind: 'context' });
        const cid = conv.conversation.id;
        // Fire-and-forget the kickoff so the greeting is ready when the chat paints.
        call('mktg-chat', { action: 'auto_open', conversation_id: cid, mode_hint: 'create_ad' })
          .catch(() => {});
        if (alive) nav(`/business/marketing/chat/${cid}`, { replace: true });
      } catch {
        if (alive) nav('/business/marketing', { replace: true });
      }
    })();
    return () => { alive = false; };
  }, [nav]);
  return <div className="app"><div className="loading">Starting ad chat…</div></div>;
}
