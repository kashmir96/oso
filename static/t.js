(function(){
  var s=document.currentScript,d=s&&s.dataset.site;
  if(!d)return;
  var e=s.src?new URL(s.src).origin.replace('://www.','://'):'',
      u=e+'/.netlify/functions/analytics-collect',
      p=location.pathname,
      q=new URLSearchParams(location.search),
      t0=performance.now(),
      sent=0,ss=sessionStorage;
  if(!ss.getItem('oso_lp')){ss.setItem('oso_lp',p);
    var src=q.get('utm_source')||'';
    if(!src&&document.referrer){try{src=new URL(document.referrer).hostname}catch(x){}}
    if(src)ss.setItem('oso_src',src);
  }
  function b(o){
    o.s=d;o.p=p;
    var j=JSON.stringify(o);
    try{navigator.sendBeacon(u,new Blob([j],{type:'text/plain'}))}
    catch(x){fetch(u,{method:'POST',body:j,keepalive:true})}
  }
  b({t:'pv',r:document.referrer,sw:screen.width,
    uc:q.get('utm_campaign')||'',us:q.get('utm_source')||'',
    um:q.get('utm_medium')||'',ux:q.get('utm_content')||'',ut:q.get('utm_term')||''});
  if(/^\/(shop\/products|shop\/bundles)/.test(p))ss.setItem('oso_last_product',p);
  function du(){if(!sent){sent=1;b({t:'du',d:Math.round((performance.now()-t0)/1000)})}}
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')du()});
  window.addEventListener('pagehide',du);
  window.oso=function(a,n,v){if(a==='event'&&n){b({t:'ev',n:n});
    if(n==='add to cart'&&v&&!ss.getItem('oso_magnet'))ss.setItem('oso_magnet',v);}};
})();
