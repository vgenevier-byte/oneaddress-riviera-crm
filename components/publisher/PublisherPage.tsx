"use client";
import { useEffect, useRef, useState } from 'react';
import type { ModuleGrant } from '@/lib/access/modules';
import { isCancelled } from '@/lib/access/operations';
import { capturePublisherDraft, readPublisherDraft } from '@/lib/publisher/draftRecovery';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  History,
  Loader2,
  MapPin,
  Music2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { usePublisherApi, PublisherRequestError, type PublisherApi, type GenerationState } from './api';
import type {
  CreationMode,
  CreativeDirection,
  CreativeMoment,
  CreativeStyle,
  CreativeUniverse,
  GenerationProgressState,
  MusicStatus,
  PublisherPost,
} from './types';
import './publisher.css';

type View = 'today' | 'history';
type DirectionSelection = {
  universe: CreativeUniverse | '';
  moment: CreativeMoment | '';
  style: CreativeStyle | '';
};

const emptyDirection: DirectionSelection = { universe: '', moment: '', style: '' };

const universes: Array<{ value: CreativeUniverse; label: string; description: string }> = [
  { value: 'landscapes', label: 'Paysages', description: 'Horizons, mer et reliefs de la Riviera.' },
  { value: 'real_estate', label: 'Immobilier', description: 'Architecture haut de gamme non identifiable.' },
  { value: 'boats', label: 'Bateaux', description: 'Yachts, navigation et élégance maritime.' },
  { value: 'cars', label: 'Voitures', description: 'Automobiles premium sans marque visible.' },
];

const moments: Array<{ value: CreativeMoment; label: string; description: string }> = [
  { value: 'morning', label: 'Matinale', description: 'Lumière fraîche, calme et commencement.' },
  { value: 'day', label: 'Jour', description: 'Clarté franche et couleurs méditerranéennes.' },
  { value: 'evening', label: 'Soirée', description: 'Chaleur subtile et élégance discrète.' },
  { value: 'night', label: 'Nuit', description: 'Bleus profonds et ambiance cinématographique.' },
];

const styles: Array<{ value: CreativeStyle; label: string; description: string }> = [
  { value: 'romantic', label: 'Romantique', description: 'Doux, intime et poétique.' },
  { value: 'dynamic', label: 'Dynamique', description: 'Vivant, énergique et en mouvement.' },
  { value: 'elegant', label: 'Élégant', description: 'Sobre, précis et intemporel.' },
  { value: 'escape', label: 'Évasion', description: 'Libre, inspirant et aspirational.' },
];

const generationSteps: Array<{ key: keyof GenerationProgressState; label: string }> = [
  { key: 'direction', label: 'Direction créative' },
  { key: 'visual', label: 'Génération du visuel' },
  { key: 'editorial', label: 'Légende et hashtags' },
  { key: 'music', label: 'Sélection musicale' },
  { key: 'finalization', label: 'Finalisation' },
];

const initialGenerationProgress: GenerationProgressState = {
  direction: 'working',
  visual: 'pending',
  editorial: 'pending',
  music: 'pending',
  finalization: 'pending',
};

const activeGenerationKey = 'oar-publisher-active-generation-v1';

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${value}T12:00:00`));

export default function PublisherPage({ userId, grant, accessRevision, onUnsavedChange }: {
  userId: string; grant: ModuleGrant; accessRevision: number; onUnsavedChange?: (dirty: boolean) => void;
}) {
  const publisherApi = usePublisherApi();
  const canWrite = grant.level === 'contribute';
  const canGenerate = canWrite && grant.sensitive.generate === true;
  const canExport = grant.sensitive.export === true;
  const canPublish = canWrite && grant.sensitive.mark_published === true;
  const activeKey = `${activeGenerationKey}:${userId}:${accessRevision}`;
  const [recovered] = useState(() => readPublisherDraft(userId, accessRevision));
  const [pendingRequestId, setPendingRequestId] = useState(() => window.sessionStorage.getItem(activeKey) || '');
  const [view, setView] = useState<View>('today');
  const [post, setPost] = useState<PublisherPost | null>(recovered?.post ?? null);
  const [history, setHistory] = useState<PublisherPost[]>([]);
  const [selectionMode, setSelectionMode] = useState<CreationMode>(recovered?.mode ?? 'daily');
  const [direction, setDirection] = useState<DirectionSelection>(recovered?.direction ?? emptyDirection);
  const [loading, setLoading] = useState(Boolean(pendingRequestId));
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(initialGenerationProgress);
  const [error, setError] = useState('');
  const [terminalGeneration, setTerminalGeneration] = useState(false);
  const [musicDirty, setMusicDirty] = useState(false);
  const requestId = useRef(pendingRequestId);
  const generationLock = useRef(false);
  const generationTracker = useRef(0);

  useEffect(() => {
    // An admitted request takes priority over a recovered creative draft.
    if (requestId.current || !recovered) void loadToday();
    return () => { generationTracker.current += 1; };
    // The account/access boundary remounts this page; do not reset a draft on a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, accessRevision, publisherApi]);

  useEffect(() => {
    const previous = readPublisherDraft(userId, accessRevision);
    capturePublisherDraft({ userId, accessRevision, post, mode: selectionMode, direction, selectedMusic: previous?.post?.id === post?.id ? previous?.selectedMusic : undefined, requests: previous?.post?.id === post?.id ? previous?.requests : undefined });
    onUnsavedChange?.(musicDirty || Boolean(direction.universe || direction.moment || direction.style));
  }, [userId, accessRevision, post, selectionMode, direction, musicDirty, onUnsavedChange]);

  function remember(value: string) { window.sessionStorage.setItem(activeKey, value); requestId.current = value; setPendingRequestId(value); }
  function forget() { window.sessionStorage.removeItem(activeKey); requestId.current = ''; setPendingRequestId(''); }
  function finish(value: PublisherPost) { setPost(value); setDirection(emptyDirection); forget(); }

  async function loadToday() {
    const tracker = ++generationTracker.current;
    setView('today'); setLoading(true); setError(''); setTerminalGeneration(false);
    try {
      const active = requestId.current;
      const result = active
        ? await publisherApi.generationStatus({ requestId: active })
        : await publisherApi.today();
      if (generationTracker.current !== tracker) return;
      if (result.state === 'ready') finish(result.post);
      else if (result.state === 'preparing') {
        setGenerating(true); generationLock.current = true;
        const ready = await resolveGeneration(result, tracker, active || undefined);
        if (generationTracker.current === tracker) finish(ready);
      } else if (result.state === 'error') { setTerminalGeneration(result.terminal === true); setError(result.error); }
      else if (active) setError('L’état de cette demande n’est pas encore disponible. Vos choix et la demande sont conservés ; reprenez son état sans lancer une nouvelle création.');
      else setPost(null);
    } catch (requestError) {
      if (!isCancelled(requestError) && generationTracker.current === tracker) {
        setTerminalGeneration(requestError instanceof PublisherRequestError && requestError.terminal);
        setError(messageOf(requestError));
      }
    } finally {
      if (generationTracker.current === tracker) {
        generationLock.current = false; setGenerating(false); setLoading(false);
      }
    }
  }

  async function createPost(selectedDirection: CreativeDirection) {
    if (!canGenerate || generationLock.current || requestId.current) return;
    generationLock.current = true; setGenerating(true); setGenerationProgress(initialGenerationProgress); setError(''); setTerminalGeneration(false);
    const currentRequestId = makeRequestId();
    remember(currentRequestId);
    const tracker = ++generationTracker.current;
    void trackGenerationProgress({ requestId: currentRequestId }, tracker);
    try {
      const result = await publisherApi.generate(selectionMode, selectedDirection, currentRequestId);
      const ready = await resolveGeneration(result, tracker, currentRequestId);
      if (generationTracker.current === tracker) finish(ready);
    } catch (requestError) {
      if (!isCancelled(requestError) && generationTracker.current === tracker) {
        setTerminalGeneration(requestError instanceof PublisherRequestError && requestError.terminal);
        setError(`${messageOf(requestError)} La demande est conservée ; « Reprendre l’état » consulte son état sans nouvelle génération.`);
      }
    } finally {
      if (generationTracker.current === tracker) {
        generationTracker.current += 1; generationLock.current = false; setGenerating(false);
      }
    }
  }

  async function resolveGeneration(result: GenerationState, tracker: number, activeRequestId?: string): Promise<PublisherPost> {
    if (result.state === 'ready') return result.post;
    if (result.state === 'error') throw new PublisherRequestError(result.error, result.terminal === true);
    if (result.state === 'preparing') {
      setGenerationProgress(result.progress || initialGenerationProgress);
      if (activeRequestId) return waitForGeneration({ requestId: activeRequestId }, tracker);
      if (result.id) return waitForGeneration({ id: result.id }, tracker);
    }
    throw new Error('La création n’a pas pu démarrer. Votre direction est conservée.');
  }

  async function trackGenerationProgress(identifier: { id?: string; requestId?: string }, tracker: number) {
    for (let attempt = 0; attempt < 180 && generationTracker.current === tracker; attempt += 1) {
      try {
        const result = await publisherApi.generationStatus(identifier);
        if (generationTracker.current !== tracker) return;
        if (result.state === 'preparing') setGenerationProgress(result.progress || initialGenerationProgress);
        if (result.state !== 'preparing') return;
      } catch (error) { if (isCancelled(error)) return; }
      await delay(1000);
    }
  }

  async function waitForGeneration(identifier: { id?: string; requestId?: string }, tracker: number): Promise<PublisherPost> {
    for (let attempt = 0; attempt < 180 && generationTracker.current === tracker; attempt += 1) {
      const result = await publisherApi.generationStatus(identifier);
      if (generationTracker.current !== tracker) throw new DOMException('Opération quittée.', 'AbortError');
      if (result.state === 'ready') return result.post;
      if (result.state === 'error') throw new PublisherRequestError(result.error, result.terminal === true);
      if (result.state === 'preparing') setGenerationProgress(result.progress || initialGenerationProgress);
      await delay(1000);
    }
    throw new Error('La création prend plus de temps que prévu. Reprenez son état dans quelques instants.');
  }

  async function showHistory() {
    if (requestId.current) return;
    const tracker = ++generationTracker.current;
    setView('history'); setLoading(true); setError('');
    try {
      const result = await publisherApi.history();
      if (generationTracker.current === tracker) setHistory(result.posts);
    } catch (requestError) {
      if (!isCancelled(requestError) && generationTracker.current === tracker) setError(messageOf(requestError));
    } finally { if (generationTracker.current === tracker) setLoading(false); }
  }

  return (
    <div className="publisher-root"><section className="publisher-shell" aria-label="Contenu Instagram Publisher">
      <header className="publisher-header"><div><span className="publisher-kicker">One Address Riviera</span><h1>Instagram Publisher</h1></div></header>
      {process.env.NEXT_PUBLIC_PUBLISHER_DEMO === '1' && <p className="publisher-demo-note" role="status">Démonstration locale · générations externes simulées</p>}
      <nav className="publisher-tabs" aria-label="Navigation du Publisher">
        <button className={view === 'today' ? 'is-active' : ''} disabled={generating} onClick={() => void loadToday()}><Sparkles size={17} /> Aujourd’hui</button>
        <button className={view === 'history' ? 'is-active' : ''} disabled={generating || Boolean(pendingRequestId)} onClick={() => void showHistory()}><History size={17} /> Historique</button>
      </nav>
      {error && <div className="publisher-alert" role="alert">{error}{terminalGeneration && canGenerate && <p><button className="publisher-small-button" onClick={() => { forget(); setTerminalGeneration(false); setError('Nouvelle demande préparée. Cliquez sur Créer la publication pour réessayer explicitement.'); }}>Préparer une nouvelle tentative</button></p>}{(!post || pendingRequestId) && <button className="publisher-small-button" onClick={() => void loadToday()}>Reprendre l’état</button>}</div>}
      {!canWrite && <p className="publisher-permission-note">Accès en lecture · consultation et historique partagé.</p>}
      {loading && !generating && view === 'today' && <PublisherLoading label="Chargement du Publisher" />}
      {generating && <GenerationProgress progress={generationProgress} />}
      {pendingRequestId && !loading && !generating && !error && <div className="publisher-empty" role="status"><p>Une demande est conservée. Consultez son état pour retrouver votre création.</p><button className="publisher-small-button" onClick={() => void loadToday()}>Reprendre l’état</button></div>}
      {view === 'today' && !loading && !generating && !pendingRequestId && !post && (
        canGenerate ? <CreativeSelector key={selectionMode} mode={selectionMode} direction={direction}
          onDirectionChange={next => { setDirection(next); setTerminalGeneration(false); }} onCreate={direction => void createPost(direction)} />
          : <div className="publisher-empty"><Sparkles size={24} /><p>Aucune création du jour. Le droit « Générer / régénérer » est nécessaire pour en préparer une.</p></div>
      )}
      {view === 'today' && !loading && !generating && !pendingRequestId && post && <PostEditor key={post.id} post={post} api={publisherApi} userId={userId} accessRevision={accessRevision}
        canWrite={canWrite} canGenerate={canGenerate} canExport={canExport} canPublish={canPublish} onChange={setPost} onError={setError} onMusicDirty={setMusicDirty}
        onNewCreation={() => { setPost(null); setSelectionMode('guided'); setDirection(emptyDirection); forget(); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
      {view === 'history' && !generating && !pendingRequestId && <HistoryGrid api={publisherApi} posts={history} loading={loading} onSelect={selected => {
        setPost(selected); setView('today'); window.scrollTo({ top: 0, behavior: 'smooth' });
      }} />}
    </section></div>
  );
}

function CreativeSelector({ mode, direction, onDirectionChange, onCreate }: {
  mode: CreationMode;
  direction: DirectionSelection;
  onDirectionChange: (direction: DirectionSelection) => void;
  onCreate: (direction: CreativeDirection) => void;
}) {
  const complete = Boolean(direction.universe && direction.moment && direction.style);

  return (
    <section className="publisher-selector">
      <div className="publisher-selector-intro">
        <span className="publisher-step-label">Étape 1 sur 2</span>
        <span className="publisher-kicker">{mode === 'daily' ? 'Publication du jour' : 'Nouvelle création'}</span>
        <h2>Choisir la direction</h2>
        <p>Trois choix simples guident le visuel et tout le package éditorial.</p>
      </div>

      <ChoiceGroup legend="1. Univers visuel" value={direction.universe} options={universes} onSelect={universe => onDirectionChange({ ...direction, universe })} />
      <ChoiceGroup legend="2. Moment" value={direction.moment} options={moments} onSelect={moment => onDirectionChange({ ...direction, moment })} />
      <ChoiceGroup legend="3. Style" value={direction.style} options={styles} onSelect={style => onDirectionChange({ ...direction, style })} />

      <button
        className="publisher-primary-button publisher-create-button"
        disabled={!complete}
        onClick={() => complete && onCreate({
          universe: direction.universe as CreativeUniverse,
          moment: direction.moment as CreativeMoment,
          style: direction.style as CreativeStyle,
        })}
      >
        <Sparkles size={18} /> Créer la publication
      </button>
      {!complete && <p className="publisher-selection-hint">Sélectionnez une option dans chaque catégorie.</p>}
    </section>
  );
}

function ChoiceGroup<T extends string>({ legend, value, options, onSelect }: {
  legend: string;
  value: T | '';
  options: Array<{ value: T; label: string; description: string }>;
  onSelect: (value: T) => void;
}) {
  return (
    <fieldset className="publisher-choice-group">
      <legend>{legend}</legend>
      <div className="publisher-choice-grid">
        {options.map(option => (
          <button
            type="button"
            className={value === option.value ? 'is-selected' : ''}
            aria-pressed={value === option.value}
            key={option.value}
            onClick={() => onSelect(option.value)}
          >
            <span className="publisher-choice-check"><Check size={14} /></span>
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function GenerationProgress({ progress }: { progress: GenerationProgressState }) {
  return (
    <section className="publisher-generation" aria-live="polite">
      <Loader2 className="publisher-spin" size={28} />
      <span className="publisher-step-label">Étape 2 sur 2</span>
      <h2>Création du package</h2>
      <p>Le traitement peut continuer après votre départ. Son état est récupérable sans relancer une génération.</p>
      <ol>
        {generationSteps.map((step, index) => (
          <li className={`is-${progress[step.key]}`} key={step.key}>
            <span>{progress[step.key] === 'done' ? <Check size={14} /> : index + 1}</span>
            {step.label}
          </li>
        ))}
      </ol>
    </section>
  );
}

function PostEditor({ post, api, userId, accessRevision, canWrite, canGenerate, canExport, canPublish, onChange, onError, onNewCreation, onMusicDirty }: {
  post: PublisherPost; api: PublisherApi; userId: string; accessRevision: number;
  canWrite: boolean; canGenerate: boolean; canExport: boolean; canPublish: boolean;
  onChange: (post: PublisherPost) => void;
  onError: (message: string) => void;
  onNewCreation: () => void;
  onMusicDirty: (dirty: boolean) => void;
}) {
  const [busy, setBusy] = useState<'text' | 'image' | 'publish' | 'music' | 'export' | ''>('');
  const [copied, setCopied] = useState('');
  const [selectedMusic, setSelectedMusic] = useState(() => {
    const saved = readPublisherDraft(userId, accessRevision);
    return saved?.post?.id === post.id && saved.selectedMusic ? saved.selectedMusic : post.music_used_id || post.primary_music_id;
  });
  const [conflict, setConflict] = useState(false);
  const [remote, setRemote] = useState<PublisherPost | null>(null);
  const mutations = useRef(new Map<string, string>(Object.entries(readPublisherDraft(userId, accessRevision)?.requests || {})));
  const mutationLock = useRef(false);
  const previousMusic = useRef({ id: post.id, used: post.music_used_id, primary: post.primary_music_id });
  const published = post.status === 'published';
  const copyBlock = `${post.caption}\n\n${post.hashtags.join(' ')}`;

  useEffect(() => {
    const previous = previousMusic.current;
    if (previous.id !== post.id || previous.used !== post.music_used_id || previous.primary !== post.primary_music_id) {
      setSelectedMusic(post.music_used_id || post.primary_music_id);
    }
    previousMusic.current = { id: post.id, used: post.music_used_id, primary: post.primary_music_id };
  }, [post.id, post.music_used_id, post.primary_music_id]);

  useEffect(() => {
    const saved = readPublisherDraft(userId, accessRevision);
    if (saved?.post?.id === post.id) capturePublisherDraft({ ...saved, selectedMusic });
    onMusicDirty(canWrite && selectedMusic !== (post.music_used_id || post.primary_music_id));
  }, [selectedMusic, userId, accessRevision, post.id, post.music_used_id, post.primary_music_id, onMusicDirty, canWrite]);

  function mutationId(action: string) {
    const key = `${post.id}:${post.revision}:${action}`;
    if (!mutations.current.has(key)) mutations.current.set(key, makeRequestId());
    const saved = readPublisherDraft(userId, accessRevision);
    if (saved?.post?.id === post.id) capturePublisherDraft({ ...saved, requests: Object.fromEntries(mutations.current) });
    return mutations.current.get(key)!;
  }
  function failed(error: unknown) {
    if (isCancelled(error)) return;
    if ((error instanceof PublisherRequestError && error.terminal) || /conflit|revision_conflict|révision|version plus récente|a changé/i.test(messageOf(error))) setConflict(true);
    onError(messageOf(error));
  }

  async function regenerate(kind: 'text' | 'image') {
    if (!canGenerate || mutationLock.current) return;
    mutationLock.current = true; setBusy(kind); onError('');
    try {
      const result = await (kind === 'text' ? api.regenerateText(post, mutationId(kind)) : api.regenerateImage(post, mutationId(kind)));
      onChange(result.post); setConflict(false);
    } catch (requestError) { failed(requestError); }
    finally { mutationLock.current = false; setBusy(''); }
  }

  async function copy(value: string, label: string) {
    if (!canExport) return;
    try {
      await api.copy(post.id, value);
      setCopied(label);
    } catch (error) { failed(error); }
  }

  async function saveImage() {
    if (!canExport || mutationLock.current) return;
    mutationLock.current = true; setBusy('export');
    try {
      const { blob: original, operation } = await api.media(post.id, 'export');
      const blob = await prepareInstagramImage(original, post.format);
      await operation.check();
      const extension = blob.type === 'image/svg+xml' ? 'svg' : blob.type === 'image/png' ? 'png' : 'jpg';
      const file = new File([blob], `one-address-riviera-${post.post_date}.${extension}`, { type: blob.type });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await operation.run(() => navigator.share({ files: [file], title: 'One Address Riviera' }));
        return;
      }
      await operation.download(blob, file.name);
    } catch (requestError) { failed(requestError); }
    finally { mutationLock.current = false; setBusy(''); }
  }

  async function updateMusicStatus(id: number, status: MusicStatus) {
    if (!canWrite || mutationLock.current) return;
    mutationLock.current = true; setBusy('music');
    try {
      const { post: next } = await api.setMusicStatus(post, id, status, mutationId(`music:${id}:${status}`));
      onChange(next); setConflict(false);
      if (id === selectedMusic && status === 'unavailable') {
        const replacement = next.music.find(item => item.id !== id && item.availability_status !== 'unavailable');
        if (replacement) setSelectedMusic(replacement.id);
      }
    } catch (requestError) { failed(requestError); }
    finally { mutationLock.current = false; setBusy(''); }
  }

  async function publish() {
    if (!canPublish || mutationLock.current) return;
    mutationLock.current = true; setBusy('publish'); onError('');
    try {
      const result = await api.publish(post, selectedMusic, mutationId(`publish:${selectedMusic}`));
      onChange(result.post); setConflict(false);
    } catch (requestError) { failed(requestError); }
    finally { mutationLock.current = false; setBusy(''); }
  }

  async function compare() {
    try {
      const result = await api.generationStatus({ id: post.id });
      if (result.state === 'ready') setRemote(result.post);
    } catch (error) { failed(error); }
  }

  return (
    <article className="publisher-post" data-publisher-post-id={post.id}>
      {conflict && <section className="publisher-alert" aria-label="Conflit de révision"><strong>Vérifiez la version partagée avant de réessayer.</strong><p>Votre sélection musicale et la révision d’origine sont conservées. Aucun écrasement n’a été effectué.</p><button className="publisher-small-button" onClick={() => void compare()}>Comparer la version partagée</button>{remote && <div><p>Révision partagée {remote.revision} · {remote.caption}</p><button className="publisher-small-button" onClick={() => { mutations.current.clear(); const saved = readPublisherDraft(userId, accessRevision); if (saved) capturePublisherDraft({ ...saved, requests: {} }); onChange(remote); setRemote(null); setConflict(false); onError(''); }}>Recharger cette version et abandonner le brouillon</button></div>}</section>}
      <div className="publisher-date-row">
        <div>
          <span className="publisher-kicker">{post.creation_mode === 'guided' ? 'Création guidée' : 'Publication du jour'}</span>
          <h2>{formatDate(post.post_date)}</h2>
        </div>
        <span className={`publisher-status ${published ? 'is-published' : ''}`}>
          {published ? <CheckCircle2 size={14} /> : <span className="publisher-status-dot" />}
          {published ? 'Publiée' : 'Brouillon'}
        </span>
      </div>

      <div className="publisher-direction-summary" aria-label="Direction créative">
        <span>{post.creative_universe}</span>
        <span>{post.creative_moment}</span>
        <span>{post.creative_style}</span>
      </div>

      <div className={`publisher-visual ${post.format === 'Reel' ? 'is-reel' : ''}`}>
        <PublisherImage api={api} post={post} alt={`Proposition visuelle — ${post.theme}`} />
        <span>{post.format}</span>
      </div>

      <div className="publisher-action-grid">
        <button disabled={!canExport || !!busy} onClick={() => void saveImage()}><Download size={18} /> Enregistrer</button>
        <button disabled={!canGenerate || !!busy} onClick={onNewCreation}><RefreshCw size={18} /> Nouvelle création</button>
      </div>

      <button className="publisher-secondary-button" disabled={!canGenerate || published || !!busy} onClick={() => void regenerate('image')}><RefreshCw size={18} /> Régénérer le visuel</button>
      {!canExport && <p className="publisher-permission-note">L’export et les commandes de copie sont désactivés pour ce compte.</p>}
      <section className="publisher-card">
        <div className="publisher-card-heading">
          <div><span className="publisher-kicker">Ambiance</span><h3>Choix musical</h3></div>
          <Music2 size={21} />
        </div>
        <div className="publisher-music-list">
          {post.music.map((music, index) => (
            <div className={`publisher-music ${selectedMusic === music.id ? 'is-selected' : ''}`} key={music.id}>
              <button className="publisher-music-main" disabled={!canWrite || !!busy} aria-pressed={selectedMusic === music.id} onClick={() => setSelectedMusic(music.id)}>
                <span className="publisher-music-number">0{index + 1}</span>
                <span><strong>{music.title}</strong><small>{music.artist}</small></span>
                <span className="publisher-radio" aria-hidden="true" />
              </button>
              <div className="publisher-availability" aria-label={`Disponibilité de ${music.title}`}>
                <button disabled={!canWrite || !!busy} className={music.availability_status === 'available' ? 'is-active' : ''} onClick={() => void updateMusicStatus(music.id, 'available')}>Disponible</button>
                <button disabled={!canWrite || !!busy} className={music.availability_status === 'unavailable' ? 'is-unavailable' : ''} onClick={() => void updateMusicStatus(music.id, 'unavailable')}>Introuvable</button>
              </div>
            </div>
          ))}
        </div>
        <button className="publisher-small-button publisher-copy-music" disabled={!canExport || !!busy} onClick={() => {
          const music = post.music.find(item => item.id === selectedMusic);
          if (music) void copy(`${music.title} — ${music.artist}`, 'music');
        }}>
          {copied === 'music' ? <Check size={16} /> : <Clipboard size={16} />}
          {copied === 'music' ? 'Musique copiée' : 'Copier la musique choisie'}
        </button>
      </section>

      <section className="publisher-card">
        <div className="publisher-card-heading">
          <div><span className="publisher-kicker">Texte</span><h3>Légende et hashtags</h3></div>
          <button className="publisher-small-button" disabled={!canExport || !!busy} onClick={() => void copy(copyBlock, 'text')}>
            {copied === 'text' ? <Check size={16} /> : <Clipboard size={16} />}
            {copied === 'text' ? 'Copié' : 'Copier'}
          </button>
        </div>
        <p className="publisher-caption">{post.caption}</p>
        <p className="publisher-hashtags">{post.hashtags.join(' ')}</p>
        <button className="publisher-secondary-button" onClick={() => void regenerate('text')} disabled={!canGenerate || published || !!busy}>
          {busy === 'text' ? <Loader2 className="publisher-spin" size={18} /> : <RefreshCw size={18} />}
          Régénérer le texte
        </button>
      </section>

      <section className="publisher-location-card">
        <MapPin size={20} />
        <div><span className="publisher-kicker">Lieu Instagram</span><strong>{post.location}</strong></div>
      </section>

      <aside className="publisher-ai-note">
        <Sparkles size={18} />
        <p><strong>ACTIVER “AJOUTER UNE MENTION IA” DANS INSTAGRAM</strong><span> Proposition générée par IA. Vérifiez le visuel, les droits musicaux et le texte avant publication.</span></p>
      </aside>

      <div className="publisher-publish-actions">
        <a className="publisher-secondary-button" href="https://www.instagram.com/" target="_blank" rel="noreferrer"><ArrowUpRight size={18} /> Ouvrir Instagram</a>
        <button className="publisher-primary-button" onClick={() => void publish()} disabled={!canPublish || published || !!busy || !selectedMusic}>
          {busy === 'publish' ? <Loader2 className="publisher-spin" size={18} /> : <CheckCircle2 size={18} />}
          {published ? 'Publication confirmée' : 'Marquer comme publié'}
        </button>
      </div>
    </article>
  );
}

function HistoryGrid({ api, posts, loading, onSelect }: { api: PublisherApi; posts: PublisherPost[]; loading: boolean; onSelect: (post: PublisherPost) => void }) {
  if (loading && posts.length === 0) return <PublisherLoading label="Chargement de l’historique" />;
  if (posts.length === 0) return <div className="publisher-empty"><History size={24} /><p>Aucune publication dans l’historique.</p></div>;
  return (
    <section className="publisher-history">
      <div className="publisher-history-heading"><span className="publisher-kicker">30 dernières créations</span><h2>Historique</h2></div>
      <div className="publisher-history-grid">
        {posts.map(item => (
          <button key={item.id} onClick={() => onSelect(item)} aria-label={`Ouvrir ${item.creative_universe}, ${item.creative_moment}, ${item.creative_style}`}>
            <PublisherImage api={api} post={item} alt="" />
            <span className="publisher-history-date">{new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(`${item.post_date}T12:00:00`))}</span>
            <span className="publisher-history-direction">{item.creative_universe} · {item.creative_moment} · {item.creative_style}</span>
            {item.status === 'published' && <CheckCircle2 size={16} />}
          </button>
        ))}
      </div>
    </section>
  );
}

function PublisherImage({ api, post, alt }: { api: PublisherApi; post: PublisherPost; alt: string }) {
  const [source, setSource] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true, url = '';
    let stop: (() => void) | undefined;
    const remove = () => { if (url) URL.revokeObjectURL(url); url = ''; if (alive) setSource(''); };
    void api.media(post.id, 'image').then(({ blob, operation }) => {
      if (!alive || operation.signal.aborted) return;
      url = URL.createObjectURL(blob); setSource(url); setError(false);
      operation.signal.addEventListener('abort', remove, { once: true });
      stop = () => operation.signal.removeEventListener('abort', remove);
    }).catch(error => { if (alive && !isCancelled(error)) setError(true); });
    return () => { alive = false; stop?.(); remove(); };
  }, [api, post.id, post.revision]);
  if (error) return <span role="status">Visuel indisponible</span>;
  // Authenticated in-memory blob only: Next image optimization must not cache it.
  // eslint-disable-next-line @next/next/no-img-element
  return source ? <img src={source} alt={alt} /> : <span aria-label="Chargement du visuel" />;
}

function PublisherLoading({ label }: { label: string }) {
  return <div className="publisher-loading"><Loader2 className="publisher-spin" size={24} /><p>{label}</p></div>;
}

function makeRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function delay(milliseconds: number) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

async function prepareInstagramImage(blob: Blob, format: string) {
  if (typeof createImageBitmap !== 'function') return blob;
  let image: ImageBitmap;
  try { image = await createImageBitmap(blob); } catch { return blob; }
  const targetWidth = 1080;
  const targetHeight = format === 'Reel' ? 1920 : 1350;
  const targetRatio = targetWidth / targetHeight;
  const sourceRatio = image.width / image.height;
  const sourceWidth = sourceRatio > targetRatio ? image.height * targetRatio : image.width;
  const sourceHeight = sourceRatio > targetRatio ? image.height : image.width / targetRatio;
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) return blob;
  context.drawImage(
    image,
    (image.width - sourceWidth) / 2,
    (image.height - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );
  image.close();
  return new Promise<Blob>(resolve => canvas.toBlob(result => resolve(result || blob), 'image/jpeg', 0.92));
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Une erreur est survenue.';
}
