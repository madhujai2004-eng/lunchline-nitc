import LunchLine from './lunchline';
import { requestContext } from './runtime';
import { handleApi } from './service';
import type { CatalogResponse } from './types';

export const dynamic = 'force-dynamic';
export default async function Home() {
  const {db,user} = await requestContext();
  if (!user) return <main className="signin-screen"><div><p className="brand">LunchLine</p><h1>Your next break starts here.</h1><p>Order a quick bite or reserve tomorrow’s lunch.</p><a className="primary-button" href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a><p className="signin-note">Private campus pilot · Test payments</p></div></main>;
  const response = await handleApi(new Request('https://lunchline.local/api/catalog'),db,user);
  if (!response.ok) return <main className="signin-screen"><div><h1>The canteen is reconnecting.</h1><p>Please refresh in a moment.</p></div></main>;
  const initial:CatalogResponse = await response.json();
  return <LunchLine initial={initial} />;
}
