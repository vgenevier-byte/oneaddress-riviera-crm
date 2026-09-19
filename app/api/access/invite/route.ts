import {sendInvitation} from '@/lib/server/invitations';
export const runtime='nodejs';
export const POST=(request:Request)=>sendInvitation(request);
