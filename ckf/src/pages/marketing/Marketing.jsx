import { Routes, Route, Navigate } from 'react-router-dom';
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
      <Route path="wizard" element={<Wizard />} />
      <Route path="wizard/:id" element={<Wizard />} />
      <Route path="*" element={<Navigate to="" replace />} />
    </Routes>
  );
}
