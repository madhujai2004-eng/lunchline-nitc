import type { Database, User } from './service';
import type { AccountResponse, Quote, RegistryEntry } from './feature-types';
import { walletBalance } from './delivery';
import { locations } from './campus';

export function featureError(message:string,status=400):never { throw {expected:true,message,status}; }
export async function readBody(request:Request):Promise<Record<string,any>> {
  const value=await request.json().catch(()=>featureError('Invalid request body.'));
  if (!value || typeof value!=='object' || Array.isArray(value)) featureError('Invalid request body.');
  return value as Record<string,any>;
}
export const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export function istDate(now:Date) { return new Date(now.getTime()+330*60000).toISOString().slice(0,10); }
export async function initializeFeatures(db:Database) {
  await db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('delivery_secret',?)").bind(crypto.randomUUID()+crypto.randomUUID()).run();
}
export async function approvedProfile(db:Database,user:User,date:string) {
  return db.prepare('SELECT r.* FROM registry r JOIN identities i ON lower(i.email)=r.email WHERE i.user_id=? AND r.active=1 AND r.expires_on>=?').bind(user.id,date).first();
}
function registryView(r:Record<string,any>):RegistryEntry {
  return {email:r.email,studentId:r.student_id,role:r.role,residence:r.residence,needApproved:!!r.need_approved,active:!!r.active,expiresOn:r.expires_on};
}
export async function accountInfo(db:Database,user:User,now:Date):Promise<AccountResponse> {
  const identity=await db.prepare('SELECT email FROM identities WHERE user_id=?').bind(user.id).first();
  const client=await db.prepare("SELECT value FROM settings WHERE key='google_client_id'").first();
  const registry=identity ? await db.prepare('SELECT * FROM registry WHERE email=?').bind(identity.email).first():null;
  const profile=await approvedProfile(db,user,istDate(now));
  const kind=profile?.role==='student' && profile.need_approved ? profile.residence : 'none';
  const descriptions:Record<string,string>={hostel:'10% off food on every order while your approval is active.',day_scholar:'25% off one meal unit per service day. Extra items use the regular price.',none:'Student benefits require a verified college Google account and an active, need-approved student record.'};
  const entries=(await db.prepare('SELECT * FROM wallet_entries WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all()).results;
  const incidents=(await db.prepare("SELECT * FROM incidents WHERE courier_user_id=? ORDER BY created_at DESC LIMIT 100").bind(user.id).all()).results;
  return {
    google:{configured:!!client?.value,clientId:client?.value||null,linked:!!identity,email:identity?.email??null},
    profile:registry?registryView(registry):null,
    discount:{kind:kind==='hostel'||kind==='day_scholar'?kind:'none',description:descriptions[kind]??descriptions.none},
    wallet:{balance:(await walletBalance(db,user.id))/100,entries:entries.map(e=>({id:e.id,kind:e.kind,amount:e.amount_paise/100,createdAt:e.created_at,sourceId:e.source_id}))},
    incidents:incidents.map(i=>({id:i.id,orderId:i.order_id,courierUserId:i.courier_user_id,status:i.status,reason:i.reason,fine:i.fine_paise/100,createdAt:i.created_at})),
    canDeliver:profile?.role==='student' && !!profile.student_id && !incidents.some(i=>i.status==='open'||i.status==='fined'),
  };
}
export function deliveryFeePaise(subtotal:number) {
  if (subtotal<=5000) return 1000;
  if (subtotal<=10000) return 1500;
  if (subtotal<=20000) return 2000;
  return 2500+Math.max(0,Math.ceil((subtotal-30000)/10000))*500;
}
export async function calculateQuote(db:Database,user:User,items:Record<string,any>[],slot:Record<string,any>,data:Record<string,any>,now:Date) {
  const subtotal=items.reduce((sum,i)=>sum+Math.round(i.price*100)*i.quantity,0);
  const profile=await approvedProfile(db,user,slot.date);
  let kind:'hostel'|'day_scholar'|'none'='none';
  let discount=0;
  let basis=0;
  let description='Regular menu prices';
  if (profile?.role==='student' && profile.need_approved) {
    if (profile.residence==='hostel') {
      kind='hostel';basis=subtotal;discount=Math.round(subtotal*0.10);description='10% hostel student food discount';
    } else if (profile.residence==='day_scholar') {
      const mealPrices=items.filter(i=>i.meal_eligible || i.category==='meal').map(i=>Math.round(i.price*100));
      const used=await db.prepare("SELECT order_id FROM discount_claims WHERE student_id=? AND pickup_date=? AND status<>'released'").bind(profile.student_id,slot.date).first();
      if (mealPrices.length && !used) {
        kind='day_scholar';basis=Math.max(...mealPrices);discount=Math.round(basis*0.25);description='25% day-scholar discount on one meal unit';
      } else description=used?'Your meal discount is already reserved or used for this date.':'Add an eligible meal to use your daily discount.';
    }
  }
  const fulfillment=data.fulfillment??'pickup';
  if (!['pickup','delivery'].includes(fulfillment)) featureError('Choose pickup or campus delivery.');
  if (fulfillment==='delivery' && !locations.some(l=>l.id===data.destination)) featureError('Choose a listed campus meeting point.');
  if (data.useWallet!==undefined && typeof data.useWallet!=='boolean') featureError('Choose whether to use wallet credit.');
  const fee=fulfillment==='delivery'?deliveryFeePaise(subtotal):0;
  const total=subtotal-discount+fee;
  const wallet=data.useWallet?Math.min(total,await walletBalance(db,user.id)):0;
  const quote:Quote={subtotal:subtotal/100,discount:discount/100,discountKind:kind,discountDescription:description,deliveryFee:fee/100,total:total/100,walletUsed:wallet/100,payNow:(total-wallet)/100,depositNow:Math.ceil((total-wallet)/2)/100};
  return {quote,subtotal,discount,basis,fee,total,wallet,kind,studentId:kind==='none'?null:profile?.student_id,fulfillment,destination:fulfillment==='delivery'?data.destination:null};
}

function decodePart(part:string) {
  const bytes=Uint8Array.from(atob(part.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  return {bytes,text:new TextDecoder().decode(bytes)};
}
let publicKeys:{expires:number;keys:JsonWebKey[]}|null=null;
async function verifiedGoogleClaims(token:string,clientId:string,nonce:string,now:Date) {
  if (typeof token!=='string' || token.length>12000) featureError('Invalid Google credential.');
  const parts=token.split('.');
  if (parts.length!==3) featureError('Invalid Google credential.');
  let header:any,claims:any,signature:Uint8Array;
  try {header=JSON.parse(decodePart(parts[0]).text);claims=JSON.parse(decodePart(parts[1]).text);signature=decodePart(parts[2]).bytes;}
  catch {return featureError('Invalid Google credential.');}
  if(header.alg!=='RS256'||typeof header.kid!=='string') featureError('Unsupported Google credential.');
  if (!publicKeys || publicKeys.expires<now.getTime() || !publicKeys.keys.some(k=>(k as any).kid===header.kid)) {
    const result=await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!result.ok) featureError('Google verification is temporarily unavailable.',503);
    const payload=await result.json() as {keys:JsonWebKey[]};
    publicKeys={expires:now.getTime()+10*60000,keys:payload.keys};
  }
  const jwk=publicKeys.keys.find(k=>(k as any).kid===header.kid);
  if (!jwk) featureError('Google verification key was not found.');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature!.buffer as ArrayBuffer,new TextEncoder().encode(parts[0]+'.'+parts[1]));
  const seconds=Math.floor(now.getTime()/1000);
  if(!valid || claims.aud!==clientId || !['https://accounts.google.com','accounts.google.com'].includes(claims.iss) || !Number.isFinite(claims.exp)||claims.exp<=seconds || !Number.isFinite(claims.iat)||claims.iat>seconds+60 || claims.nonce!==nonce) featureError('Google verification failed. Please sign in again.',401);
  if(claims.hd!=='nitc.ac.in'||claims.email_verified!==true||typeof claims.email!=='string'||!claims.email.toLowerCase().endsWith('@nitc.ac.in')||typeof claims.sub!=='string') featureError('Use a Google-managed NIT Calicut college account.',403);
  return {sub:claims.sub,email:claims.email.toLowerCase()};
}

export async function handleFeatureApi(request:Request,db:Database,user:User,now:Date):Promise<Response|null> {
  const path=new URL(request.url).pathname.replace(/\/$/,'');
  if(path==='/api/account'&&request.method==='GET') return reply(await accountInfo(db,user,now));
  if(path==='/api/google/nonce'&&request.method==='POST') {
    const config=await db.prepare("SELECT value FROM settings WHERE key='google_client_id'").first();
    if(!config?.value) featureError('Google college verification is awaiting a Web Client ID.',503);
    const nonce=crypto.randomUUID();
    await db.prepare('INSERT INTO google_nonces (user_id,nonce,expires_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET nonce=excluded.nonce,expires_at=excluded.expires_at').bind(user.id,nonce,now.getTime()+600000).run();
    return reply({nonce,clientId:config.value});
  }
  if(path==='/api/google/link'&&request.method==='POST') {
    const data=await readBody(request);
    const config=await db.prepare("SELECT value FROM settings WHERE key='google_client_id'").first();
    const nonce=await db.prepare('SELECT nonce,expires_at FROM google_nonces WHERE user_id=?').bind(user.id).first();
    if(!config?.value||!nonce||nonce.expires_at<now.getTime()) featureError('Start college verification again.',401);
    const claims=await verifiedGoogleClaims(data.credential,config.value,nonce.nonce,now);
    const linked=await db.prepare('SELECT google_sub,email FROM identities WHERE user_id=?').bind(user.id).first();
    if(linked && (linked.google_sub!==claims.sub||linked.email!==claims.email)) featureError('This account already has a linked college identity. Contact the administrator.',409);
    try {
      await db.batch([
        db.prepare('INSERT INTO identities (user_id,google_sub,email,verified_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET verified_at=excluded.verified_at').bind(user.id,claims.sub,claims.email,now.toISOString()),
        db.prepare('DELETE FROM google_nonces WHERE user_id=? AND nonce=?').bind(user.id,nonce.nonce),
      ]);
    } catch {featureError('This college identity is already linked to another account.',409);}
    return reply(await accountInfo(db,user,now));
  }
  if(path==='/api/vendor/config') {
    if(request.method==='GET') {
      const config=await db.prepare("SELECT value FROM settings WHERE key='google_client_id'").first();
      return reply({googleClientId:config?.value||null});
    }
    if(request.method==='PATCH') {
      const data=await readBody(request);
      if(typeof data.googleClientId!=='string'||(data.googleClientId && !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(data.googleClientId))) featureError('Enter a Google OAuth Web Client ID.');
      await db.prepare("INSERT INTO settings (key,value) VALUES ('google_client_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(data.googleClientId).run();
      return reply({ok:true});
    }
  }
  if(path==='/api/vendor/registry') {
    if(request.method==='GET') return reply({entries:(await db.prepare('SELECT * FROM registry ORDER BY email LIMIT 500').all()).results.map(registryView)});
    if(request.method==='POST') {
      const data=await readBody(request);
      const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
      const studentId=typeof data.studentId==='string'?data.studentId.trim().toUpperCase():null;
      if(!/^[a-z0-9._%+-]+@nitc\.ac\.in$/.test(email)) featureError('Enter an NIT Calicut college email.');
      if(!['student','faculty','staff'].includes(data.role)||!['hostel','day_scholar','none'].includes(data.residence)) featureError('Choose a registry role and residence.');
      if(data.role==='student'&&(!studentId||!/^[A-Z0-9_-]{4,32}$/.test(studentId)||data.residence==='none')) featureError('Students need their unique institute ID and residence category.');
      if(typeof data.needApproved!=='boolean'||typeof data.active!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(data.expiresOn)||isNaN(Date.parse(data.expiresOn))) featureError('Choose an approval expiry date and status.');
      const prior=await db.prepare('SELECT student_id FROM registry WHERE email=?').bind(email).first();
      if(prior?.student_id&&prior.student_id!==studentId) featureError('An approved student ID is fixed. Contact the institute administrator to correct an identity.',409);
      try {
        await db.prepare('INSERT INTO registry (email,student_id,role,residence,need_approved,active,expires_on) VALUES (?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET student_id=excluded.student_id,role=excluded.role,residence=excluded.residence,need_approved=excluded.need_approved,active=excluded.active,expires_on=excluded.expires_on').bind(email,data.role==='student'?studentId:null,data.role,data.role==='student'?data.residence:'none',Number(data.role==='student'&&data.needApproved),Number(data.active),data.expiresOn).run();
      } catch {featureError('This institute ID is already assigned to another college email.',409);}
      return reply({ok:true});
    }
  }
  return null;
}
