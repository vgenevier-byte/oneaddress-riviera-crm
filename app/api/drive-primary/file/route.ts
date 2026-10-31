import {createPrimaryDownloadHandler} from '@/lib/server/drivePrimary';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=120;
export const GET=createPrimaryDownloadHandler();
