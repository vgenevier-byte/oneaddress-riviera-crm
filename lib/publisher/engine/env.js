export function readEnv(name, fallback = '') {
  return process.env[name]?.trim() || fallback;
}
export function requireEnv(name) {
  const value = readEnv(name);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

// Separate credential name prevents accidentally using the CRM database.
export function publisherConfig() {
  return {
    databaseUrl: requireEnv('PUBLISHER_DATABASE_URL'),
    openAIKey: readEnv('OPENAI_API_KEY'),
    textModel: readEnv('OPENAI_TEXT_MODEL', 'gpt-5.6-luna'),
    imageModel: readEnv('OPENAI_IMAGE_MODEL', 'gpt-image-2'),
    imageQuality: readEnv('OPENAI_IMAGE_QUALITY', 'medium'),
    timezone: readEnv('PUBLISHER_TIMEZONE', 'Europe/Paris'),
  };
}

export function localSimulation() {
  if (readEnv('PUBLISHER_LOCAL_SIMULATION') !== '1') return false;
  const database = new URL(requireEnv('PUBLISHER_DATABASE_URL'));
  const auth = new URL(requireEnv('NEXT_PUBLIC_SUPABASE_URL'));
  if (process.env.VERCEL || ![database, auth].every(url => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      || !database.pathname.startsWith('/publisher_')) {
    throw new Error('Publisher simulation requires isolated loopback database and Auth.');
  }
  return true;
}
