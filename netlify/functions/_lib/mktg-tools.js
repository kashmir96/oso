// Tool definitions + handlers for mktg-chat.
// Tools execute server-side with the user_id resolved by the gate.
const { sbSelect, sbInsert, sbUpdate } = require('./ckf-sb.js');

// Lightweight ILIKE search across one or more text columns.
function ilike(col, q) { return `${col}=ilike.*${encodeURIComponent(q)}*`; }
function or(...clauses) { return `or=(${clauses.join(',')})`; }

const TOOLS = [
  // ── READ — campaigns / products ──
  {
    name: 'list_campaigns',
    description: 'List the three campaigns (tallow-balm, shampoo-bar, reviana) with their funnel role and brief description. Cheap; call once per chat to ground.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_campaign',
    description: 'Detail for one campaign: products, role, weekly cadence, default landing domain.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'campaign id, e.g. "tallow-balm"' } },
      required: ['id'],
    },
  },

  // ── READ — concepts ──
  {
    name: 'search_concepts',
    description: 'Find concepts by name fragment, campaign, status, or any combination. Returns up to 50.',
    input_schema: {
      type: 'object',
      properties: {
        q:           { type: 'string', description: 'name fragment (case-insensitive)' },
        campaign_id: { type: 'string' },
        status:      { type: 'string', enum: ['workhorse','top_revenue','efficient','tested','new','gap','retired'] },
      },
    },
  },
  {
    name: 'get_concept',
    description: 'Full detail for one concept including its copy archetype, visual archetypes, video openers and every ad using it.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },

  // ── READ — ads ──
  {
    name: 'search_ads',
    description: 'Find ads by name fragment, body fragment, campaign, concept, or format. Returns up to 50, sorted by spend desc by default.',
    input_schema: {
      type: 'object',
      properties: {
        q:           { type: 'string', description: 'fragment matched against ad_name OR title OR body' },
        campaign_id: { type: 'string' },
        concept_id:  { type: 'string' },
        format:      { type: 'string', enum: ['static','video','carousel','reel'] },
        sort:        { type: 'string', enum: ['spend','results','cpr','recent'], description: 'default spend' },
      },
    },
  },
  {
    name: 'get_ad',
    description: 'Full detail for one ad including its primary text, headline, CTA, performance and which concept it belongs to.',
    input_schema: {
      type: 'object',
      properties: { ad_id: { type: 'string' } },
      required: ['ad_id'],
    },
  },
  {
    name: 'top_ads',
    description: 'Top N ads by a given metric across the whole account or one campaign. Use to ground "what is working".',
    input_schema: {
      type: 'object',
      properties: {
        metric:      { type: 'string', enum: ['spend','results','cpr_low'], description: 'cpr_low = cheapest CPR (≥1 result)' },
        campaign_id: { type: 'string' },
        limit:       { type: 'integer', minimum: 1, maximum: 25, description: 'default 10' },
      },
      required: ['metric'],
    },
  },

  // ── READ — production scripts ──
  {
    name: 'search_scripts',
    description: 'Find production scripts by campaign, name fragment, or status.',
    input_schema: {
      type: 'object',
      properties: {
        q:           { type: 'string' },
        campaign_id: { type: 'string' },
        status:      { type: 'string', enum: ['production-ready','draft'] },
      },
    },
  },
  {
    name: 'get_script',
    description: 'Full body of one production script, plus its linked concepts and openers.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },

  // ── READ — reference library ──
  {
    name: 'list_archetypes',
    description: 'List archetypes of a given kind. Use sparingly — full lists are long; prefer get_concept which already includes a concept\'s archetypes.',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['copy','visual','video'] } },
      required: ['kind'],
    },
  },
  {
    name: 'list_offers',
    description: 'All offer mechanics in the playbook (Bundle, BOGO, Free shipping, etc.) with example copy.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_hooks',
    description: 'All reusable hooks/taglines/social-proof phrases. Filterable by intended use.',
    input_schema: {
      type: 'object',
      properties: {
        use: { type: 'string', enum: ['opener','reframe','social_proof','cta','tagline','stat'] },
      },
    },
  },
  {
    name: 'list_locked_decisions',
    description: 'Locked brand-level decisions Curtis has made (customer count, retail status, naming, framing). ALWAYS check before writing copy that touches these.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── READ — uploads + memory ──
  {
    name: 'list_uploads',
    description: 'Recent uploads in this conversation or against a target entity. Use to recall what the user has shared.',
    input_schema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string' },
        target_table:    { type: 'string' },
        target_id:       { type: 'string' },
        limit:           { type: 'integer', minimum: 1, maximum: 50, description: 'default 20' },
      },
    },
  },
  {
    name: 'get_memory_facts',
    description: 'Long-term marketing memory facts. Filter by topic if relevant. Default returns all active facts ordered by importance.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
  },

  // ── WRITE — capture context ──
  {
    name: 'save_upload',
    description: 'Save a piece of context the user has pasted (text snippet, link, or screenshot description). Optionally tag it to an entity (ad/concept/script/campaign) so the playbook accumulates examples. Use kind="text" for pasted copy or notes, kind="link" for URLs.',
    input_schema: {
      type: 'object',
      properties: {
        kind:         { type: 'string', enum: ['text','link'] },
        text_body:    { type: 'string', description: 'required when kind=text' },
        url:          { type: 'string', description: 'required when kind=link' },
        caption:      { type: 'string', description: '"what\'s good about this" — why the user shared it' },
        tags:         { type: 'array', items: { type: 'string' } },
        target_table: { type: 'string', enum: ['mktg_ads','mktg_concepts','mktg_production_scripts','mktg_campaigns'], description: 'optional — pin this to an entity' },
        target_id:    { type: 'string' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'tag_upload_to_entity',
    description: "Pin (or re-pin) an existing upload to an entity. Use when the user retroactively says 'oh, that screenshot was for the Reviana day cream concept'.",
    input_schema: {
      type: 'object',
      properties: {
        upload_id:    { type: 'string' },
        target_table: { type: 'string', enum: ['mktg_ads','mktg_concepts','mktg_production_scripts','mktg_campaigns'] },
        target_id:    { type: 'string' },
      },
      required: ['upload_id', 'target_table', 'target_id'],
    },
  },

  // ── WRITE — memory ──
  {
    name: 'remember',
    description: "Save a long-term marketing memory fact. Use for durable insights about what works/doesn't, brand voice rules, audience preferences, recurring patterns. NOT one-off ad performance numbers (those live in mktg_ads). Examples: 'video openers VS3 (founder direct address) outperform VS1 by 30% on Reviana', 'kiwi-coded language (sandflies, sou'westers) lifts CTR on tallow-balm', 'avoid 'anti-aging' framing — Curtis decided 2026-04-25'.",
    input_schema: {
      type: 'object',
      properties: {
        fact:       { type: 'string' },
        topic:      { type: 'string', description: 'optional cluster: copy_voice, audience, video_format, channel, brand_rule, etc.' },
        importance: { type: 'integer', minimum: 1, maximum: 5, description: 'default 3' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'archive_memory_fact',
    description: 'Archive a memory fact when it becomes outdated.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },

  // ── WIZARD — only available in conversations with kind='wizard' ──
  // The AI calls these to drive the attached mktg_drafts row through the 7
  // steps in a chat-style flow. Each tool both updates the draft and returns
  // the relevant data so the AI can immediately summarise it for the user.
  {
    name: 'wizard_set',
    description: "Save what you've learned about the ad so far. Pass only the fields you've confirmed with Curtis. Call this every time he tells you the objective, picks a campaign, picks a format, names the audience, or gives the landing URL — don't batch. ALSO set trust_priority once audience + campaign are known: 'high' for cold + reactive-skin / first-touch eczema audiences (lead with explicit trust levers); 'medium' for warm or familiar audiences; 'low' for retargeting / existing customers (skip trust setup, lead with offer).",
    input_schema: {
      type: 'object',
      properties: {
        objective:      { type: 'string' },
        campaign_id:    { type: 'string', enum: ['tallow-balm','shampoo-bar','reviana'] },
        format:         { type: 'string', enum: ['static','video','carousel','reel'] },
        audience_type:  { type: 'string', description: "free text: 'cold NZ women 25-55', 'lapsed customers', 'lookalike from purchases', etc." },
        landing_url:    { type: 'string' },
        trust_priority: { type: 'string', enum: ['high','medium','low'], description: 'Auto-infer from audience + campaign. high = cold + reactive-skin or first-touch eczema; medium = warm/familiar; low = retargeting/existing customers.' },
        notes:          { type: 'string', description: 'extra context Curtis volunteered (mood, urgency, constraints) that should ride with the draft' },
      },
    },
  },
  {
    name: 'wizard_recommend_concepts',
    description: 'Generate 3 concept recommendations from the playbook + top-performing ads in the chosen campaign, filtered to the objective and format. Call this once objective + campaign + format are set. Returns the recommendations; relay them to Curtis so he can pick one.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'wizard_select_concept',
    description: "Lock in the concept Curtis picked. Use a real concept id from the recommendations OR pass a brand-new name (will be stored as a synthetic id like '__new:Reviana-Founder-Direct').",
    input_schema: {
      type: 'object',
      properties: {
        concept_id: { type: 'string', description: 'an existing concept id from the recommendations' },
        new_name:   { type: 'string', description: 'name for a brand-new concept Curtis wants to invent' },
      },
    },
  },
  {
    name: 'wizard_generate_creative',
    description: 'Produce creative direction (video timeline + VO + B-roll for video/reel; visual brief + image prompts for static/carousel). Call once a concept is selected.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'wizard_generate_copy',
    description: "Generate 2 primary-text variants + headline + description + CTA + Meta naming. If Curtis has feedback on a previous attempt, pass it in `feedback` to regenerate with that direction.",
    input_schema: {
      type: 'object',
      properties: {
        feedback: { type: 'string', description: 'optional — what to change about the previous attempt' },
      },
    },
  },
  {
    name: 'wizard_critique',
    description: "Run an internal critique pass on the current draft (creative + both copy variants). Call this AFTER wizard_generate_copy and BEFORE asking Curtis which variant he prefers. Returns scores + verdict (ship/repair/replace) + repair_instructions. If verdict='repair', call wizard_generate_copy again with the repair_instructions as feedback. If verdict='replace', go back to wizard_recommend_concepts. If verdict='ship', proceed to ask Curtis for his pick. Don't read the verdict aloud word-for-word — just act on it conversationally (\"Quick gut-check on this — I want to tighten the hook before you pick.\" rather than \"My critique scored this 6/10.\").",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'wizard_finalize',
    description: "When Curtis approves the copy, call this with the chosen primary_text PLUS which variant he picked (v1 or v2) and a short summary of any edits he made. Marks the draft as approved, runs a feedback-analysis pass on his pick, persists the analysis, and returns the ready-to-paste payload.",
    input_schema: {
      type: 'object',
      properties: {
        primary_text_final: { type: 'string', description: "the final primary text Curtis approved (either v1, v2, or his edit)" },
        chosen_variant:     { type: 'string', enum: ['v1','v2'], description: "which generated variant he picked as the base. Required so the system can learn his preferences." },
        user_edits_diff:    { type: 'string', description: "short plain-English summary of what he changed from the chosen variant (e.g. 'cut the second paragraph', 'swapped the EANZ line in', 'tightened opener'). Empty string if shipped as-is." },
      },
      required: ['primary_text_final','chosen_variant'],
    },
  },
  {
    name: 'wizard_get_state',
    description: "Read the current draft state — useful at the start of a turn to see what's already filled in (e.g. when resuming a wizard conversation).",
    input_schema: { type: 'object', properties: {} },
  },
];

function clip(text, max = 6000) {
  if (typeof text !== 'string') text = JSON.stringify(text);
  return text.length > max ? text.slice(0, max) + '…[truncated]' : text;
}

const VALID_TARGET_TABLES = new Set([
  'mktg_ads','mktg_concepts','mktg_production_scripts','mktg_campaigns',
]);

async function execute(name, input, ctx) {
  const { userId, conversationId } = ctx;

  switch (name) {
    case 'list_campaigns': {
      const rows = await sbSelect('mktg_campaigns', 'select=id,name,role_in_funnel,description,domain_default&order=name.asc');
      return { campaigns: rows };
    }
    case 'get_campaign': {
      if (!input?.id) return { error: 'id required' };
      const enc = encodeURIComponent(input.id);
      const [c, products, concepts, ads, scripts] = await Promise.all([
        sbSelect('mktg_campaigns', `id=eq.${enc}&select=*&limit=1`),
        sbSelect('mktg_products', `campaign_id=eq.${enc}&select=id,name,full_name,format,size,price_from_nzd,status`),
        sbSelect('mktg_concepts', `campaign_id=eq.${enc}&select=id,name,status,performance->spend_nzd,performance->results,performance->cpr_nzd&order=status.asc`),
        sbSelect('mktg_ads', `campaign_id=eq.${enc}&select=ad_id,ad_name,format&limit=20`),
        sbSelect('mktg_production_scripts', `campaign_id=eq.${enc}&select=id,name,status,length_words`),
      ]);
      return {
        campaign: c[0] || null,
        products,
        concepts,
        ads_sample: ads,
        scripts,
      };
    }

    case 'search_concepts': {
      const filters = ['select=*'];
      if (input?.campaign_id) filters.push(`campaign_id=eq.${encodeURIComponent(input.campaign_id)}`);
      if (input?.status)      filters.push(`status=eq.${encodeURIComponent(input.status)}`);
      if (input?.q)           filters.push(ilike('name', input.q));
      filters.push('limit=50&order=status.asc,name.asc');
      const rows = await sbSelect('mktg_concepts', filters.join('&'));
      return { concepts: rows };
    }
    case 'get_concept': {
      if (!input?.id) return { error: 'id required' };
      const enc = encodeURIComponent(input.id);
      const [conceptRows] = await Promise.all([
        sbSelect('mktg_concepts', `id=eq.${enc}&select=*&limit=1`),
      ]);
      const concept = conceptRows[0];
      if (!concept) return { concept: null };
      const [copyArch, visualArch, videoOpeners, ads] = await Promise.all([
        concept.copy_archetype_id
          ? sbSelect('mktg_copy_archetypes', `id=eq.${encodeURIComponent(concept.copy_archetype_id)}&select=*&limit=1`)
          : Promise.resolve([]),
        concept.visual_archetype_ids?.length
          ? sbSelect('mktg_visual_archetypes', `id=in.(${concept.visual_archetype_ids.map(encodeURIComponent).join(',')})&select=*`)
          : Promise.resolve([]),
        concept.video_opener_ids?.length
          ? sbSelect('mktg_video_openers', `id=in.(${concept.video_opener_ids.map(encodeURIComponent).join(',')})&select=*`)
          : Promise.resolve([]),
        sbSelect('mktg_ads', `concept_id=eq.${enc}&select=ad_id,ad_name,format,performance&limit=30`),
      ]);
      return {
        concept,
        copy_archetype: copyArch[0] || null,
        visual_archetypes: visualArch,
        video_openers: videoOpeners,
        ads,
      };
    }

    case 'search_ads': {
      const filters = ['select=ad_id,ad_name,campaign_id,concept_id,format,title,body,call_to_action,performance'];
      if (input?.campaign_id) filters.push(`campaign_id=eq.${encodeURIComponent(input.campaign_id)}`);
      if (input?.concept_id)  filters.push(`concept_id=eq.${encodeURIComponent(input.concept_id)}`);
      if (input?.format)      filters.push(`format=eq.${encodeURIComponent(input.format)}`);
      if (input?.q) {
        const q = encodeURIComponent(input.q);
        filters.push(or(`ad_name.ilike.*${q}*`, `title.ilike.*${q}*`, `body.ilike.*${q}*`));
      }
      filters.push('limit=50');
      const rows = await sbSelect('mktg_ads', filters.join('&'));
      const sort = input?.sort || 'spend';
      if (sort === 'spend')   rows.sort((a,b) => (b.performance?.spend_nzd || 0) - (a.performance?.spend_nzd || 0));
      if (sort === 'results') rows.sort((a,b) => (b.performance?.results || 0) - (a.performance?.results || 0));
      if (sort === 'cpr')     rows.sort((a,b) => (a.performance?.cpr_nzd ?? Infinity) - (b.performance?.cpr_nzd ?? Infinity));
      // 'recent' would need perf_synced_at; skip for now
      return { ads: rows };
    }
    case 'get_ad': {
      if (!input?.ad_id) return { error: 'ad_id required' };
      const rows = await sbSelect('mktg_ads', `ad_id=eq.${encodeURIComponent(input.ad_id)}&select=*&limit=1`);
      return { ad: rows[0] || null };
    }
    case 'top_ads': {
      if (!input?.metric) return { error: 'metric required' };
      const limit = Math.min(input.limit || 10, 25);
      const filters = ['select=ad_id,ad_name,campaign_id,format,performance'];
      if (input?.campaign_id) filters.push(`campaign_id=eq.${encodeURIComponent(input.campaign_id)}`);
      const rows = await sbSelect('mktg_ads', filters.join('&'));
      const scored = rows.filter((a) => a.performance);
      if (input.metric === 'spend')   scored.sort((a,b) => (b.performance.spend_nzd || 0) - (a.performance.spend_nzd || 0));
      if (input.metric === 'results') scored.sort((a,b) => (b.performance.results || 0) - (a.performance.results || 0));
      if (input.metric === 'cpr_low') {
        scored.filter((a) => (a.performance.results || 0) >= 1)
              .sort((a,b) => (a.performance.cpr_nzd ?? Infinity) - (b.performance.cpr_nzd ?? Infinity));
      }
      return { ads: scored.slice(0, limit) };
    }

    case 'search_scripts': {
      const filters = ['select=id,campaign_id,name,status,length_words,concept_ids,video_opener_ids'];
      if (input?.campaign_id) filters.push(`campaign_id=eq.${encodeURIComponent(input.campaign_id)}`);
      if (input?.status)      filters.push(`status=eq.${encodeURIComponent(input.status)}`);
      if (input?.q)           filters.push(ilike('name', input.q));
      const rows = await sbSelect('mktg_production_scripts', filters.join('&'));
      return { scripts: rows };
    }
    case 'get_script': {
      if (!input?.id) return { error: 'id required' };
      const rows = await sbSelect('mktg_production_scripts', `id=eq.${encodeURIComponent(input.id)}&select=*&limit=1`);
      return { script: rows[0] || null };
    }

    case 'list_archetypes': {
      if (input?.kind === 'visual') return { archetypes: await sbSelect('mktg_visual_archetypes', 'select=*&order=id.asc') };
      if (input?.kind === 'video')  return { archetypes: await sbSelect('mktg_video_openers', 'select=*&order=id.asc') };
      return { archetypes: await sbSelect('mktg_copy_archetypes', 'select=id,campaign_id,type_label,name,description,status&order=campaign_id.asc,type_label.asc') };
    }
    case 'list_offers': {
      return { offers: await sbSelect('mktg_offers', 'select=*&order=name.asc') };
    }
    case 'list_hooks': {
      const filter = input?.use ? `&use=eq.${encodeURIComponent(input.use)}` : '';
      return { hooks: await sbSelect('mktg_hooks', `select=*${filter}&order=use.asc,id.asc`) };
    }
    case 'list_locked_decisions': {
      return { locked_decisions: await sbSelect('mktg_locked_decisions', 'select=*&order=key.asc') };
    }

    case 'list_uploads': {
      const filters = [`user_id=eq.${userId}`, 'select=id,kind,text_body,url,caption,tags,target_table,target_id,created_at'];
      if (input?.conversation_id) filters.push(`conversation_id=eq.${encodeURIComponent(input.conversation_id)}`);
      else if (conversationId)    filters.push(`conversation_id=eq.${conversationId}`);
      if (input?.target_table)    filters.push(`target_table=eq.${encodeURIComponent(input.target_table)}`);
      if (input?.target_id)       filters.push(`target_id=eq.${encodeURIComponent(input.target_id)}`);
      const limit = Math.min(input?.limit || 20, 50);
      filters.push(`order=created_at.desc&limit=${limit}`);
      const rows = await sbSelect('mktg_uploads', filters.join('&'));
      return { uploads: rows };
    }
    case 'get_memory_facts': {
      const topicFilter = input?.topic ? `&topic=eq.${encodeURIComponent(input.topic)}` : '';
      const limit = Math.min(input?.limit || 100, 200);
      const rows = await sbSelect(
        'mktg_memory_facts',
        `user_id=eq.${userId}&archived=eq.false${topicFilter}&order=importance.desc,created_at.desc&limit=${limit}&select=id,fact,topic,importance,created_at`
      );
      return { facts: rows };
    }

    case 'save_upload': {
      const kind = input?.kind;
      if (!['text','link'].includes(kind)) return { error: 'kind must be text or link' };
      if (kind === 'text' && !input?.text_body) return { error: 'text_body required when kind=text' };
      if (kind === 'link' && !input?.url) return { error: 'url required when kind=link' };
      if (input?.target_table && !VALID_TARGET_TABLES.has(input.target_table)) return { error: 'invalid target_table' };
      const row = await sbInsert('mktg_uploads', {
        user_id:         userId,
        kind,
        text_body:       kind === 'text' ? input.text_body : null,
        url:             kind === 'link' ? input.url : null,
        caption:         input.caption || null,
        tags:            Array.isArray(input.tags) ? input.tags : [],
        target_table:    input.target_table || null,
        target_id:       input.target_id || null,
        conversation_id: conversationId || null,
      });
      return { saved: true, upload_id: row?.id };
    }
    case 'tag_upload_to_entity': {
      if (!input?.upload_id || !input?.target_table || !input?.target_id) {
        return { error: 'upload_id, target_table, target_id required' };
      }
      if (!VALID_TARGET_TABLES.has(input.target_table)) return { error: 'invalid target_table' };
      await sbUpdate(
        'mktg_uploads',
        `id=eq.${encodeURIComponent(input.upload_id)}&user_id=eq.${userId}`,
        { target_table: input.target_table, target_id: input.target_id }
      );
      return { tagged: true };
    }

    case 'remember': {
      if (!input?.fact) return { error: 'fact required' };
      const row = await sbInsert('mktg_memory_facts', {
        user_id:    userId,
        fact:       input.fact,
        topic:      input.topic || null,
        importance: Math.min(Math.max(input.importance || 3, 1), 5),
        source_message_id: ctx.messageId || null,
      });
      return { saved: true, id: row?.id };
    }
    case 'archive_memory_fact': {
      if (!input?.id) return { error: 'id required' };
      await sbUpdate('mktg_memory_facts', `id=eq.${encodeURIComponent(input.id)}&user_id=eq.${userId}`, { archived: true });
      return { archived: true };
    }

    // ── WIZARD tools — drive ad creation inside any marketing chat. The draft
    // is auto-created on first use and linked to the conversation, so no
    // upfront ceremony is needed. The same chat can switch back to context
    // mode after an ad is shipped. ──
    case 'wizard_get_state': {
      const draft = await getDraftForConversation(userId, ctx.conversationId);
      return { draft };
    }
    case 'wizard_set': {
      const allowed = ['objective','campaign_id','format','audience_type','landing_url','trust_priority','notes'];
      const patch = {};
      for (const k of allowed) if (input[k] !== undefined && input[k] !== null && input[k] !== '') patch[k] = input[k];
      if (patch.trust_priority && !['high','medium','low'].includes(patch.trust_priority)) {
        return { error: 'trust_priority must be high|medium|low' };
      }
      if (Object.keys(patch).length === 0) return { error: 'nothing to set' };
      const draft = await ensureDraftForConversation(userId, ctx.conversationId);
      const after = { ...draft, ...patch };
      patch.current_step = nextStepFor(after);
      patch.updated_at = new Date().toISOString();
      const updated = await sbUpdate('mktg_drafts', `id=eq.${encodeURIComponent(draft.id)}&user_id=eq.${userId}`, patch);
      return {
        saved: true,
        fields: Object.keys(patch).filter((k) => k !== 'updated_at' && k !== 'current_step'),
        draft: Array.isArray(updated) ? updated[0] : updated,
      };
    }
    case 'wizard_recommend_concepts': {
      const mktgAds = require('../mktg-ads.js');
      const draft = await ensureDraftForConversation(userId, ctx.conversationId);
      const concepts = await mktgAds.generateConcepts(draft);
      const updated = await mktgAds.patchDraft(userId, draft.id, {
        recommended_concepts: concepts,
        current_step: 'concept',
      });
      return { recommended_concepts: concepts, draft: updated };
    }
    case 'wizard_select_concept': {
      const id = input?.concept_id || (input?.new_name ? `__new:${input.new_name}` : null);
      if (!id) return { error: 'concept_id or new_name required' };
      const draft = await ensureDraftForConversation(userId, ctx.conversationId);
      const updated = await sbUpdate(
        'mktg_drafts',
        `id=eq.${encodeURIComponent(draft.id)}&user_id=eq.${userId}`,
        { selected_concept_id: id, current_step: 'creative', updated_at: new Date().toISOString() }
      );
      return { selected: true, concept_id: id, draft: Array.isArray(updated) ? updated[0] : updated };
    }
    case 'wizard_generate_creative': {
      const mktgAds = require('../mktg-ads.js');
      const draft = await ensureDraftForConversation(userId, ctx.conversationId);
      const creative = await mktgAds.generateCreative(draft);
      const updated = await mktgAds.patchDraft(userId, draft.id, { creative, current_step: 'creative' });
      return { creative, draft: updated };
    }
    case 'wizard_generate_copy': {
      const mktgAds = require('../mktg-ads.js');
      const draft = await ensureDraftForConversation(userId, ctx.conversationId);
      const out = await mktgAds.generateCopy(draft, { feedback: input?.feedback });
      const updated = await mktgAds.patchDraft(userId, draft.id, {
        primary_text_v1: out.primary_text_v1 || null,
        primary_text_v2: out.primary_text_v2 || null,
        headline:        out.headline || null,
        description:     out.description || null,
        cta:             out.cta || null,
        naming:          out.naming || null,
        current_step:    'copy',
      });
      return { ...out, draft: updated };
    }
    case 'wizard_critique': {
      const mktgAds = require('../mktg-ads.js');
      const draft = await ensureDraftForConversation(userId, ctx.conversationId);
      if (!draft.primary_text_v1 || !draft.primary_text_v2) {
        return { error: 'need both primary_text_v1 and primary_text_v2 — call wizard_generate_copy first' };
      }
      const critique = await mktgAds.generateCritique(draft);
      return { critique };
    }
    case 'wizard_finalize': {
      if (!input?.primary_text_final) return { error: 'primary_text_final required' };
      if (!input?.chosen_variant || !['v1','v2'].includes(input.chosen_variant)) {
        return { error: "chosen_variant required (must be 'v1' or 'v2')" };
      }
      const mktgAds = require('../mktg-ads.js');
      const draft = await ensureDraftForConversation(userId, ctx.conversationId);

      // Stamp the final text + variant pick + edits diff first so generateFeedback
      // sees the full picture (chosen variant + final shipped text + diff note).
      const stamped = await sbUpdate(
        'mktg_drafts',
        `id=eq.${encodeURIComponent(draft.id)}&user_id=eq.${userId}`,
        {
          primary_text_final: input.primary_text_final,
          chosen_variant:     input.chosen_variant,
          rejected_variant:   input.chosen_variant === 'v1' ? 'v2' : 'v1',
          user_edits_diff:    input.user_edits_diff || null,
          status:             'approved',
          current_step:       'final',
          updated_at:         new Date().toISOString(),
        }
      );
      const stampedDraft = Array.isArray(stamped) ? stamped[0] : stamped;

      // Run feedback analysis. Don't fail finalize if this errors — feedback
      // capture is best-effort, the ad still ships.
      let feedback = null;
      try {
        feedback = await mktgAds.generateFeedback(stampedDraft, {
          chosen_variant:  input.chosen_variant,
          user_edits_diff: input.user_edits_diff || '',
        });
        await sbUpdate(
          'mktg_drafts',
          `id=eq.${encodeURIComponent(draft.id)}&user_id=eq.${userId}`,
          { feedback_analysis: feedback, updated_at: new Date().toISOString() }
        );
      } catch (e) {
        console.error('[wizard_finalize] feedback analysis failed:', e?.message || e);
      }

      // Bridge high-confidence recurring patterns into mktg_memory_facts so
      // future generations learn from them. Threshold: confidence ≥ 8 AND a
      // non-empty recurring_pattern_hint.
      let bridged_fact_id = null;
      if (feedback?.confidence >= 8 && feedback?.recurring_pattern_hint?.trim()) {
        try {
          const fact = await sbInsert('mktg_memory_facts', {
            user_id:    userId,
            fact:       feedback.recurring_pattern_hint.trim(),
            topic:      'copy_voice',
            importance: 4,
            source_message_id: ctx.messageId || null,
          });
          bridged_fact_id = fact?.id || null;
        } catch (e) {
          console.error('[wizard_finalize] memory bridge failed:', e?.message || e);
        }
      }

      const finalDraft = stampedDraft;
      return {
        finalized: true,
        ready_to_paste: {
          ad_name:        finalDraft.naming || null,
          primary_text:   input.primary_text_final,
          headline:       finalDraft.headline || null,
          description:    finalDraft.description || null,
          cta:            finalDraft.cta || null,
          website_url:    finalDraft.landing_url || null,
        },
        feedback_analysis: feedback,
        bridged_fact_id,
        draft: finalDraft,
      };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
}

// Highest step the draft is ready for, given which fields are populated.
function nextStepFor(d) {
  if (!d.objective)   return 'objective';
  if (!d.campaign_id) return 'campaign';
  if (!d.format || !d.audience_type || !d.landing_url) return 'format';
  if (!d.selected_concept_id) return 'concept';
  if (!d.creative)    return 'creative';
  if (!d.primary_text_final) return 'copy';
  return 'final';
}

// Find an existing wizard draft for this conversation, or null.
async function getDraftForConversation(userId, conversationId) {
  if (!conversationId) return null;
  const rows = await sbSelect(
    'mktg_drafts',
    `user_id=eq.${userId}&conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.desc&limit=1&select=*`
  );
  return rows?.[0] || null;
}

// Get-or-create the wizard draft for this conversation. Lazy creation means
// you only get a draft once the AI actually starts collecting fields, not
// every time someone opens the chat.
async function ensureDraftForConversation(userId, conversationId) {
  if (!conversationId) throw new Error('conversation_id required to attach a wizard draft');
  const existing = await getDraftForConversation(userId, conversationId);
  if (existing) return existing;
  const created = await sbInsert('mktg_drafts', {
    user_id:         userId,
    conversation_id: conversationId,
    status:          'draft',
    current_step:    'objective',
  });
  return created;
}

module.exports = { TOOLS, execute, clip };
