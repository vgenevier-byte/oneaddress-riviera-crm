export const dynamic='force-dynamic';
export function GET(){
 const sha=process.env.OAR_RELEASE_SHA||process.env.VERCEL_GIT_COMMIT_SHA;
 return Response.json(sha&&/^[a-f0-9]{40}$/.test(sha)?{sha}:{error:'Release identity unavailable.'},{status:sha&&/^[a-f0-9]{40}$/.test(sha)?200:503,headers:{'cache-control':'no-store'}});
}
