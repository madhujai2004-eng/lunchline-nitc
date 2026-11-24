import { env } from 'cloudflare:workers';
import { getChatGPTUser } from './chatgpt-auth';
import type { Database, User } from './service';

export async function requestContext(): Promise<{db:Database;user:User|null}> {
  const visitor = await getChatGPTUser();
  const binding = env as unknown as {DB:Database;VENDOR_EMAIL?:string};
  if (!binding.DB) throw new Error('Database binding is unavailable.');
  return {
    db: binding.DB,
    user: visitor ? {
      id:visitor.userId,
      email:visitor.email,
      name:visitor.displayName,
      isVendor:visitor.email.toLowerCase() === binding.VENDOR_EMAIL?.toLowerCase(),
    } : null,
  };
}
