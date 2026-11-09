// Server only. Invoked by a private Cron job, never the browser.
import {createClient} from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Missing ${name}`);return value;};
const client=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
webpush.setVapidDetails(env('VAPID_SUBJECT'),env('VAPID_PUBLIC_KEY'),env('VAPID_PRIVATE_KEY'));
const allowedHost=(endpoint:string)=>{try{const u=new URL(endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname)||u.hostname.endsWith('.notify.windows.com'));}catch{return false;}};
Deno.serve(async request=>{
  // Dedicated random scheduler secret, stored only in Vault / Edge secrets.
  const expected=env('CRON_SECRET');const provided=request.headers.get('x-cron-secret')||'';
  const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [a,b]=await Promise.all([digest(expected),digest(provided)]);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
  if(difference||request.method!=='POST')return new Response('Unauthorized',{status:401});
  try {
    let sent=0,failed=0;
    for(let offset=0;;offset+=500){
      const {data:rows,error}=await client.from('planner_records').select('user_id,id,payload').eq('type','action').eq('deleted',false).neq('payload->>status','completed').order('user_id').order('id').range(offset,offset+499);
      if(error)throw error;
      for(const row of rows||[]) {
        const action=row.payload;const now=Date.now();
        if(!Number.isFinite(Date.parse(action.notifyAt))||Date.parse(action.notifyAt)>now||(action.status==='snoozed'&&Date.parse(action.snoozeUntil)>now))continue;
        const {data:settings}=await client.from('planner_records').select('payload').eq('user_id',row.user_id).eq('id','settings').eq('deleted',false).maybeSingle();
        const repeat=Math.max(15,Math.min(1440,Number(settings?.payload?.repeatMinutes)||60));
        const {data:subscriptions,error:subError}=await client.from('push_subscriptions').select('endpoint,subscription').eq('user_id',row.user_id);
        if(subError)throw subError;
        for(const sub of subscriptions||[]) {
          if(!allowedHost(sub.endpoint)||sub.subscription.endpoint!==sub.endpoint)continue;
          const {data:claimed,error:claimError}=await client.rpc('claim_push',{p_user:row.user_id,p_action:row.id,p_endpoint:sub.endpoint,p_minutes:repeat});
          if(claimError)throw claimError;if(!claimed)continue;
          // Recheck completion after claiming to reduce race windows.
          const {data:latest}=await client.from('planner_records').select('payload,deleted').eq('user_id',row.user_id).eq('id',row.id).single();
          if(!latest||latest.deleted||latest.payload.status==='completed'||(latest.payload.status==='snoozed'&&Date.parse(latest.payload.snoozeUntil)>Date.now()))continue;
          try {await webpush.sendNotification(sub.subscription,JSON.stringify({title:'Ритм — требуется действие',body:action.title,tag:row.id}),{TTL:300});sent++;}
          catch(error){failed++;const status=(error as {statusCode?:number}).statusCode;if(status===404||status===410)await client.from('push_subscriptions').delete().eq('user_id',row.user_id).eq('endpoint',sub.endpoint);else await client.from('push_delivery').update({next_send_at:new Date(Date.now()+300000).toISOString()}).eq('user_id',row.user_id).eq('action_id',row.id).eq('endpoint',sub.endpoint);}
        }
      }
      if((rows?.length||0)<500)break;
    }
    return Response.json({sent,failed});
  }catch {return Response.json({error:'Push dispatch failed; inspect server logs and retry.'},{status:500});}
});
