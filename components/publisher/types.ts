export type MusicStatus = 'available' | 'unavailable' | 'unknown';
export type CreationMode = 'daily' | 'guided';
export type CreativeUniverse = 'landscapes' | 'real_estate' | 'boats' | 'cars';
export type CreativeMoment = 'morning' | 'day' | 'evening' | 'night';
export type CreativeStyle = 'romantic' | 'dynamic' | 'elegant' | 'escape';

export interface CreativeDirection {
  universe: CreativeUniverse;
  moment: CreativeMoment;
  style: CreativeStyle;
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
  availability_status: MusicStatus;
}

export interface PublisherPost {
  id: string;
  revision: number;
  post_date: string;
  creation_mode: CreationMode;
  creative_universe: string;
  creative_moment: string;
  creative_style: string;
  theme: string;
  moment: string;
  scene_summary: string;
  visual_signature: string;
  caption: string;
  hashtags: string[];
  music: PublisherMusic[];
  primary_music_id: number;
  music_used_id: number | null;
  location: string;
  format: string;
  image_src: string;
  status: 'draft' | 'published';
  generation_status: 'generating' | 'ready' | 'error';
  generation_progress: GenerationProgressState;
  published_at: string | null;
}
