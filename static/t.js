(function(){
  var s=document.currentScript,d=s&&s.dataset.site;
  if(!d)return;
  var e=s.src?new URL(s.src).origin:'',
      u=e+'/.netlify/functions/analytics-collect',
      p=location.pathname,
      q=new URLSearchParams(location.search),
      t0=performance.now(),
      sent=0;
  function b(o){
    o.s=d;o.p=p;
    var j=JSON.stringify(o);
    try{navigator.sendBeacon(u,new Blob([j],{type:'application/json'}))}
    catch(x){fetch(u,{method:'POST',body:j,keepalive:true,headers:{'Content-Type':'application/json'}})}
  }
  b({t:'pv',r:document.referrer,sw:screen.width,
    uc:q.get('utm_campaign')||'',us:q.get('utm_source')||'',
    um:q.get('utm_medium')||'',ux:q.get('utm_content')||'',ut:q.get('utm_term')||''});
  function du(){if(!sent){sent=1;b({t:'du',d:Math.round((performance.now()-t0)/1000)})}}
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')du()});
  window.addEventListener('pagehide',du);
  window.oso=function(a,n){if(a==='event'&&n)b({t:'ev',n:n})};
})();
