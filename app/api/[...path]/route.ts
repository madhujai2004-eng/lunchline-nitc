import { requestContext } from '../../runtime';
import { handleApi } from '../../service';

export const dynamic = 'force-dynamic';
async function handler(request: Request) {
  const {db,user} = await requestContext();
  return handleApi(request,db,user);
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
