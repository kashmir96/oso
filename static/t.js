(function(){
  var s=document.currentScript,d=s&&s.dataset.site;
  if(!d)return;
  var e=s.src?new URL(s.src).origin.replace('://www.','://'):'',
      u=e+'/.netlify/functions/analytics-collect',
      p=location.pathname,
      q=new URLSearchParams(location.search),
      t0=performance.now(),
      sent=0,ss=sessionStorage;

  // ── Persistent visitor ID (90-day first-party cookie) ──
  function gc(n){var m=document.cookie.match('(^|;)\\s*'+n+'=([^;]*)');return m?m[2]:'';}
  function sc(n,v,days){var d=new Date();d.setTime(d.getTime()+days*864e5);document.cookie=n+'='+v+';expires='+d.toUTCString()+';path=/;SameSite=Lax';}
  var vid=gc('oso_vid');
  if(!vid){vid=Math.random().toString(36).substr(2)+Date.now().toString(36);sc('oso_vid',vid,90);}
  else{sc('oso_vid',vid,90);} // refresh expiry

  // ── Attribution source detection ──
  var us=q.get('utm_source')||'',uc=q.get('utm_campaign')||'',
      um=q.get('utm_medium')||'',ux=q.get('utm_content')||'',ut=q.get('utm_term')||'';
  // Auto-detect source from click IDs
  var gclid=q.get('gclid'),fbclid=q.get('fbclid'),msclkid=q.get('msclkid');
  if(!us&&gclid){us='google';um=um||'cpc';}
  if(!us&&fbclid){us='facebook';um=um||'cpc';}
  if(!us&&msclkid){us='bing';um=um||'cpc';}
  // Fallback to referrer
  var ref=document.referrer,refDom='';
  if(ref){try{refDom=new URL(ref).hostname.replace(/^www\./,'')}catch(x){}}
  if(!us&&refDom&&refDom.indexOf(location.hostname)===-1){
    if(/google\./i.test(refDom))us='google',um=um||'organic';
    else if(/facebook\.com|fb\.com/i.test(refDom))us='facebook',um=um||'social';
    else if(/instagram\.com/i.test(refDom))us='instagram',um=um||'social';
    else if(/bing\.com/i.test(refDom))us='bing',um=um||'organic';
    else if(/youtube\.com/i.test(refDom))us='youtube',um=um||'social';
    else if(/tiktok\.com/i.test(refDom))us='tiktok',um=um||'social';
    else us=refDom,um=um||'referral';
  }

  // ── First-touch / last-touch cookies ──
  var hasSource=us||uc||um;
  if(!gc('oso_ft_src')&&hasSource){
    sc('oso_ft_src',us,90);sc('oso_ft_cam',uc,90);sc('oso_ft_med',um,90);
    sc('oso_ft_con',ux,90);sc('oso_ft_term',ut,90);
  }
  if(hasSource){
    sc('oso_lt_src',us,90);sc('oso_lt_cam',uc,90);sc('oso_lt_med',um,90);
    sc('oso_lt_con',ux,90);sc('oso_lt_term',ut,90);
  }

  if(!ss.getItem('oso_lp')){ss.setItem('oso_lp',p);
    if(us)ss.setItem('oso_src',us);
  }
  function b(o){
    o.s=d;o.p=p;
    var j=JSON.stringify(o);
    try{navigator.sendBeacon(u,new Blob([j],{type:'text/plain'}))}
    catch(x){fetch(u,{method:'POST',body:j,keepalive:true})}
  }
  b({t:'pv',r:ref,sw:screen.width,vid:vid,
    uc:uc,us:us,um:um,ux:ux,ut:ut,
    ft_src:gc('oso_ft_src')||'',ft_cam:gc('oso_ft_cam')||'',ft_med:gc('oso_ft_med')||'',
    lt_src:gc('oso_lt_src')||'',lt_cam:gc('oso_lt_cam')||'',lt_med:gc('oso_lt_med')||'',
    gclid:gclid||'',fbclid:fbclid||''});
  if(/^\/(shop\/products|shop\/bundles)/.test(p))ss.setItem('oso_last_product',p);
  function du(){if(!sent){sent=1;b({t:'du',d:Math.round((performance.now()-t0)/1000),vid:vid})}}
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')du()});
  window.addEventListener('pagehide',du);
  window.oso=function(a,n,v){if(a==='event'&&n){b({t:'ev',n:n,vid:vid});
    if(n==='add to cart'&&v&&!ss.getItem('oso_magnet'))ss.setItem('oso_magnet',v);}};
})();
