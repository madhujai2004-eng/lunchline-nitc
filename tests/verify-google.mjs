import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { SqliteD1 } from './sqlite-d1.mjs';
import { handleApi } from '../app/service.ts';

test('Google linking verifies signed claims, session nonce and unique college ownership', async () => {
  const db = new SqliteD1();
  const originalFetch = globalThis.fetch;
  const now = new Date('2026-11-24T01:00:00Z');
  const seconds = Math.floor(now.getTime() / 1000);
  const user = { id: 'google-qa-one', email: 'login@example.com', name: 'QA', isVendor: false };
  const secondUser = { ...user, id: 'google-qa-two' };
  const clientId = '123456.apps.googleusercontent.com';
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'qa-google-key' };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  async function token(claims) {
    const message = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode(claims);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(message));
    return message + '.' + Buffer.from(signature).toString('base64url');
  }
  async function post(path, body, who = user) {
    const response = await handleApi(new Request('https://lunchline.test/api/' + path, { method:'POST', headers:{'Content-Type':'application/json','Origin':'https://lunchline.test'}, body:JSON.stringify(body) }), db, who, now);
    return { status:response.status, data:await response.json() };
  }
  try {
    const directory = new URL('../drizzle/', import.meta.url);
    for (const file of (await fs.readdir(directory)).filter(name=>name.endsWith('.sql')).sort()) await db.exec(await fs.readFile(new URL(file,directory),'utf8'));
    await db.prepare("INSERT INTO settings (key,value) VALUES ('google_client_id',?)").bind(clientId).run();
    globalThis.fetch = async url => {
      assert.equal(String(url),'https://www.googleapis.com/oauth2/v3/certs');
      return Response.json({keys:[jwk]});
    };
    const start = await post('google/nonce',{});
    assert.equal(start.status,200);
    const claims = { iss:'https://accounts.google.com', aud:clientId, sub:'google-campus-student', email:'b240001cs@nitc.ac.in', email_verified:true, hd:'nitc.ac.in', iat:seconds-30, exp:seconds+300, nonce:start.data.nonce };
    for (const invalid of [{aud:'other-client'}, {iss:'https://attacker.test'}, {exp:seconds-1}, {nonce:'another-session'}, {hd:'example.com'}, {email:'student@example.com'}, {email_verified:false}]) {
      const result = await post('google/link',{credential:await token({...claims,...invalid})});
      assert.ok([400,401,403].includes(result.status), JSON.stringify(result));
    }
    const signed = await token(claims);
    const corrupted = signed.slice(0,-8) + 'AAAAAAAA';
    assert.equal((await post('google/link',{credential:corrupted})).status,401);
    const linked = await post('google/link',{credential:signed});
    assert.equal(linked.status,200,JSON.stringify(linked));
    assert.equal(linked.data.google.linked,true);
    assert.equal(linked.data.discount.kind,'none','College email alone must not create student eligibility');
    assert.equal((await post('google/link',{credential:signed})).status,401,'Consumed nonce cannot be replayed');
    const secondStart = await post('google/nonce',{},secondUser);
    assert.equal((await post('google/link',{credential:await token({...claims,nonce:secondStart.data.nonce})},secondUser)).status,409);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
