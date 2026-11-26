// Règles pures : état d'une app à partir de ses versions App Store, détection
// des changements et message Discord. Testé dans test/status.test.mjs.

/** Libellé et pastille de chaque état App Store Connect (appVersionState). */
export const STATES = {
  READY_FOR_DISTRIBUTION: { label: 'en ligne', dot: '🟢' },
  PROCESSING_FOR_DISTRIBUTION: { label: 'en cours de mise en ligne', dot: '🟢' },
  PENDING_DEVELOPER_RELEASE: { label: 'validée, à publier', dot: '🟣' },
  PENDING_APPLE_RELEASE: { label: 'validée, sortie programmée', dot: '🟣' },
  ACCEPTED: { label: 'validée', dot: '🟣' },
  IN_REVIEW: { label: 'en review', dot: '🔵' },
  WAITING_FOR_REVIEW: { label: 'en attente de review', dot: '🟡' },
  READY_FOR_REVIEW: { label: 'prête pour la review', dot: '🟡' },
  WAITING_FOR_EXPORT_COMPLIANCE: { label: 'en attente (export compliance)', dot: '🟡' },
  PREPARE_FOR_SUBMISSION: { label: 'en préparation', dot: '⚪' },
  REJECTED: { label: 'rejetée', dot: '🔴' },
  METADATA_REJECTED: { label: 'métadonnées rejetées', dot: '🔴' },
  INVALID_BINARY: { label: 'binaire invalide', dot: '🔴' },
  DEVELOPER_REJECTED: { label: 'retirée de la review', dot: '⚪' },
};

const LIVE = new Set(['READY_FOR_DISTRIBUTION', 'PROCESSING_FOR_DISTRIBUTION']);
const IGNORED = new Set(['REPLACED_WITH_NEW_VERSION', 'REMOVED_FROM_SALE']);

/** Titre du message pour un passage vers cet état. */
const HEADLINES = {
  IN_REVIEW: (app) => `🔵 ${app} passe en review`,
  WAITING_FOR_REVIEW: (app) => `🟡 ${app} est envoyée en review`,
  PENDING_DEVELOPER_RELEASE: (app) => `🟣 ${app} est validée par Apple, à publier`,
  PENDING_APPLE_RELEASE: (app) => `🟣 ${app} est validée par Apple`,
  ACCEPTED: (app) => `🟣 ${app} est validée par Apple`,
  READY_FOR_DISTRIBUTION: (app) => `🎉 ${app} est en ligne`,
  PROCESSING_FOR_DISTRIBUTION: (app) => `🟢 ${app} part en ligne`,
  REJECTED: (app) => `🔴 ${app} est rejetée par Apple`,
  METADATA_REJECTED: (app) => `🔴 ${app} : métadonnées rejetées`,
  INVALID_BINARY: (app) => `🔴 ${app} : binaire invalide`,
  DEVELOPER_REJECTED: (app) => `⚪ ${app} est retirée de la review`,
  PREPARE_FOR_SUBMISSION: (app) => `⚪ ${app} prépare une nouvelle version`,
};

/** Version lisible : « 1.1.53 (270) » ou « 1.1.53 ». */
export function versionLabel(v) {
  return v.build ? `${v.version} (${v.build})` : v.version;
}

/**
 * Résumé d'une app à partir de ses versions iOS (de la plus récente à la plus
 * ancienne) : la version en ligne et la version en cours (si elle existe).
 * versions : [{ version, build, state, createdDate }]
 */
export function summarize(versions) {
  const relevant = versions.filter((v) => !IGNORED.has(v.state));
  const live = relevant.find((v) => LIVE.has(v.state)) ?? null;
  const pending =
    relevant.find((v) => !LIVE.has(v.state) && (!live || v.createdDate > live.createdDate)) ?? null;
  return {
    live: live ? { version: live.version, build: live.build ?? null } : null,
    pending: pending
      ? { version: pending.version, build: pending.build ?? null, state: pending.state }
      : null,
  };
}

/** Clé comparable d'un état d'app : ce qui, s'il change, mérite un message. */
function key(s) {
  return JSON.stringify([s?.live?.version ?? null, s?.pending?.version ?? null, s?.pending?.state ?? null]);
}

/**
 * Changements entre l'ancien et le nouvel état, par app.
 * previous / current : { [appId]: { name, live, pending } }
 */
export function diff(previous, current) {
  const changes = [];
  for (const [id, now] of Object.entries(current)) {
    const before = previous[id];
    if (!before) continue; // app nouvelle : apparaît dans le tableau, sans message dédié
    if (key(before) === key(now)) continue;
    const fromState = before.pending?.state ?? (before.live ? 'READY_FOR_DISTRIBUTION' : null);
    const toState = now.pending?.state ?? (now.live ? 'READY_FOR_DISTRIBUTION' : null);
    const version = now.pending ?? now.live;
    changes.push({ id, name: now.name, fromState, toState, version });
  }
  return changes;
}

const stateLabel = (s) => STATES[s]?.label ?? s?.toLowerCase().replaceAll('_', ' ') ?? '—';
const pretty = (s) =>
  s ? s.toLowerCase().replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—';

/** Une ligne du tableau pour une app. */
export function boardLine(app) {
  const parts = [];
  if (app.live) parts.push(`iOS ${app.live.version} en ligne`);
  if (app.pending) {
    const s = STATES[app.pending.state];
    parts.push(`${s?.dot ?? '⚪'} ${app.pending.version} ${stateLabel(app.pending.state)}`);
  }
  const dot = app.pending && ['REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'].includes(app.pending.state)
    ? '🔴'
    : app.live
      ? '🟢'
      : STATES[app.pending?.state]?.dot ?? '⚪';
  return `${dot} **${app.name}** — ${parts.length ? parts.join(' · ') : 'rien en cours'}`;
}

/**
 * Embed Discord : le changement en tête (s'il y en a), puis l'état de toutes
 * les apps. changes vide = tableau seul (premier passage).
 */
export function buildMessage(changes, current, now = new Date()) {
  const apps = Object.values(current).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const board = apps.map(boardLine).join('\n');
  const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

  let title;
  let header = '';
  if (changes.length === 0) {
    title = '📱 État des apps';
  } else {
    const first = changes[0];
    title =
      changes.length === 1
        ? (HEADLINES[first.toState] ?? ((a) => `🔔 ${a} vient de changer de statut`))(first.name)
        : `🔔 ${changes.length} apps viennent de changer de statut`;
    header =
      changes
        .map(
          (c) =>
            `${changes.length > 1 ? `**${c.name}** · ` : ''}iOS ${c.version ? versionLabel(c.version) : ''} · ${pretty(c.fromState)} → ${pretty(c.toState)}`
        )
        .join('\n') + '\n\n━━━━━━━━━━━━━━━━━━\n📱 **État des apps**\n\n';
  }

  const color =
    changes.length === 0
      ? 0x5865f2
      : { IN_REVIEW: 0x3b82f6, READY_FOR_DISTRIBUTION: 0x22c55e, PENDING_DEVELOPER_RELEASE: 0xa855f7, REJECTED: 0xef4444 }[
          changes[0].toState
        ] ?? 0xf59e0b;

  return {
    embeds: [
      {
        title,
        description: header + board,
        color,
        footer: { text: `Mis à jour à ${time}` },
      },
    ],
  };
}
