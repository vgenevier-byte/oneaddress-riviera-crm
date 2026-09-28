export const PUBLISHER_COOKIE = 'oar_publisher_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
export const CONTENT_COOLDOWN_DAYS = 14;
export const GENERATION_LEASE_MINUTES = 5;
export const PUBLISHER_BLOB_ACCESS = 'private';

export const THEMES = [
  'paysage',
  'immobilier',
  'yacht',
  'automobile',
  'gastronomie',
  'lifestyle',
  'plage',
  'hôtel',
  'expérience privée',
  'table privée',
];

export const CREATIVE_UNIVERSES = {
  landscapes: {
    label: 'Paysages',
    theme: 'paysage',
    guidance: 'Un paysage de la Riviera doit dominer la composition, sans propriété, bateau ou voiture comme sujet principal.',
  },
  real_estate: {
    label: 'Immobilier',
    theme: 'immobilier',
    guidance: 'Une architecture résidentielle haut de gamme doit être le sujet principal, crédible mais non identifiable comme une adresse réelle.',
  },
  boats: {
    label: 'Bateaux',
    theme: 'yacht',
    guidance: 'Un bateau ou yacht doit être le sujet principal, avec une présence maritime nette et aucune scène de restauration dominante.',
  },
  cars: {
    label: 'Voitures',
    theme: 'automobile',
    guidance: 'Une automobile premium sans marque visible doit être le sujet principal, avec une sensation de route et de mouvement.',
  },
};

export const CREATIVE_MOMENTS = {
  morning: {
    label: 'Matinale',
    guidance: 'Lumière fraîche du matin, calme, ombres longues et sensation de commencement.',
  },
  day: {
    label: 'Jour',
    guidance: 'Lumière naturelle franche, lisibilité nette, couleurs méditerranéennes maîtrisées.',
  },
  evening: {
    label: 'Soirée',
    guidance: 'Lumière de fin de journée ou début de soirée, chaleur subtile et élégance sociale discrète.',
  },
  night: {
    label: 'Nuit',
    guidance: 'Ambiance nocturne cinématographique, bleus profonds, lumières ponctuelles raffinées, détails lisibles.',
  },
};

export const CREATIVE_STYLES = {
  romantic: {
    label: 'Romantique',
    guidance: 'Lumière douce et intime, raffinement, poésie et ambiance feutrée, sans cliché sentimental.',
  },
  dynamic: {
    label: 'Dynamique',
    guidance: 'Angle vivant, énergie, mouvement et impact visuel, sans agressivité ni effet tapageur.',
  },
  elegant: {
    label: 'Élégant',
    guidance: 'Luxe discret, sobriété, chic intemporel et composition précise.',
  },
  escape: {
    label: 'Évasion',
    guidance: 'Désir, liberté, Riviera lifestyle, aspiration et respiration dans la composition.',
  },
};

export const CONTEXTUAL_HASHTAGS = [
  '#FrenchRiviera',
  '#LuxuryConcierge',
  '#RivieraLifestyle',
  '#YachtLifestyle',
  '#PrivateLuxury',
  '#LuxuryTravel',
  '#CotedAzur',
  '#MediterraneanLiving',
];

export const RECENT_MUSIC_SEED = [
  ['Save Us (Instrumental)', 'Jason Lesser', 'available'],
  ['High With Me (Instrumental)', 'GEEZ', 'available'],
  ['On And On (Instrumental)', 'Julia Gartha', 'available'],
  ['Daydream (Instrumental)', 'Chela Rivas', 'available'],
];

export const CONFIRMED_MUSIC_SEED = [
  ['Beleza De Verao (Instrumental)', 'Kolektivo', 'available'],
  ['Fervor', 'Ross Lara', 'available'],
  ['A New Day', 'Loga Ramin Torkian', 'available'],
  ['Legends (Instrumental)', 'stereogully', 'available'],
];

export const MUSIC_LIBRARY_SEED = [
  ['La femme d’argent', 'Air'],
  ['Sunset Lover', 'Petit Biscuit'],
  ['Intro', 'The xx'],
  ['A Walk', 'Tycho'],
  ['Tadow', 'Masego & FKJ'],
  ['Porcelain', 'Moby'],
  ['Experience', 'Ludovico Einaudi'],
  ['Je te laisserai des mots', 'Patrick Watson'],
  ['Beyond', 'Leon Bridges'],
  ['Sweet Disposition', 'The Temper Trap'],
  ['Awake', 'Tycho'],
  ['Kerala', 'Bonobo'],
  ['Friday Morning', 'Khruangbin'],
  ['Open', 'Rhye'],
  ['Mystery of Love', 'Sufjan Stevens'],
  ['Turnmills', 'Maribou State'],
];
