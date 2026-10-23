import type { CarBrandId } from '@/lib/publisher/carSelection.js';

export type MusicStatus = 'available' | 'unavailable' | 'unknown';
export type CreationMode = 'daily' | 'guided';
export type CreativeUniverse = 'landscapes' | 'real_estate' | 'boats' | 'cars';
export type CreativeMoment = 'morning' | 'day' | 'evening' | 'night';
export type CreativeStyle = 'romantic' | 'dynamic' | 'elegant' | 'escape';
export type CarType = 'auto' | 'suv' | 'saloon' | 'coupe_gt' | 'sports_car' | 'convertible' | 'supercar' | 'luxury_van';

/** A requested reference, not a certification of the generated vehicle. */
export interface PublisherCarContext {
  catalogueVersion: string;
  requestedType: CarType;
  requestedBrand?: string;
  requestedModel?: string;
  resolvedType: Exclude<CarType, 'auto'>;
  referenceId: string;
  manufacturer: string;
  model: string;
  variant: string;
  generation: string;
  visualFeatures: string[];
}

export interface CreativeDirection {
  universe: CreativeUniverse;
  moment: CreativeMoment;
  style: CreativeStyle;
  carType?: CarType;
  carBrand?: CarBrandId;
  carModel?: string;
}

export type GenerationStageState = 'pending' | 'working' | 'done' | 'error';

export interface GenerationProgressState {
  direction: GenerationStageState;
  visual: GenerationStageState;
  editorial: GenerationStageState;
  music: GenerationStageState;
  finalization: GenerationStageState;
}

export interface PublisherMusic {
  id: number;
  revision: number;
  title: string;
  artist: string;
  version?: string | null;
  instagram_audio_id?: string | null;
  instagram_audio_url?: string | null;
  source?: 'legacy_catalogue' | 'manual_instagram';
  verification?: {
    status: 'confirmed' | 'not_found' | 'unknown';
    method: 'manual_instagram';
    checked_at: string;
    account: string;
    account_label: string;
    context: 'feed' | 'reel';
  } | null;
  availability_status: MusicStatus;
}

export interface MusicConfirmation {
  title: string;
  artist: string;
  version: string;
  instagramAudioUrl: string;
  acknowledged: boolean;
}

export interface PublisherPost {
  id: string;
  revision: number;
  post_date: string;
  creation_mode: CreationMode;
  creative_universe: string;
  creative_moment: string;
  creative_style: string;
  car_context?: PublisherCarContext | null;
  theme: string;
  moment: string;
  scene_summary: string;
  visual_signature: string;
  caption: string;
  hashtags: string[];
  music: PublisherMusic[];
  primary_music_id: number | null;
  selected_music_id?: number | null;
  music_used_id: number | null;
  music_context?: { account: string; account_label: string; context: 'feed' | 'reel' };
  music_state?: 'ready' | 'insufficient' | 'none';
  location: string;
  format: string;
  image_src: string;
  status: 'draft' | 'published';
  generation_status: 'generating' | 'ready' | 'error';
  generation_progress: GenerationProgressState;
  published_at: string | null;
}
