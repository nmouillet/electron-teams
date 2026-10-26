'use strict';
// electron-teams : Microsoft Teams web dans sa propre fenêtre, avec l'Electron des dépôts Arch.
// Même principe qu'electron-outlook (bulle de non-lus et fond orange dans la barre des tâches de KDE,
// zone de notification, fermeture = réduction (sauf en fin de session), lancement réduit), plus ce qu'il faut pour les appels :
// micro, caméra, partage d'écran sous Wayland (portail xdg-desktop-portal via PipeWire), sonneries
// fenêtre réduite. Techniques reprises de teams-for-linux (GPL-3.0), code réécrit.
const { app, BrowserWindow, Menu, Tray, clipboard, desktopCapturer, session, shell } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const NOM = 'electron-teams';
const URL_ACCUEIL = 'https://teams.cloud.microsoft/';
const PARTITION = 'persist:teams';
const DEBUG = process.env.ELECTRON_TEAMS_DEBUG === '1';
const ICONE = path.join(__dirname, 'icones', `${NOM}-64.png`);
const ICONE_ZONE = path.join(__dirname, 'icones', `${NOM}-32.png`);
// Données (session Microsoft, cache, fenêtre) dans ~/.config/electron-teams.
app.setPath('userData', path.join(app.getPath('appData'), NOM));
const FICHIER_FENETRE = path.join(app.getPath('userData'), 'fenetre.json');
// Pendant ce délai après le premier écran de Teams, le compteur se met en place sans fond orange.
const DELAI_DEMARRAGE_MS = 20000;

// Domaines Microsoft gardés dans l'application (Teams, connexion, réunions, fenêtres détachées).
// Tout autre lien qui ouvre une nouvelle fenêtre part dans le navigateur par défaut.
const DOMAINES_MICROSOFT = [
  'cloud.microsoft', 'teams.microsoft.com', 'teams.live.com', 'skype.com', 'office.com', 'office.net',
  'office365.com', 'live.com', 'microsoftonline.com', 'microsoft.com', 'msauth.net', 'msftauth.net',
];
// Appels : micro et caméra (media), partage d'écran (display-capture), choix de la sortie audio,
// écran gardé allumé (screen-wake-lock), placement des fenêtres de réunion (window-management).
const PERMISSIONS = new Set([
  'notifications', 'media', 'display-capture', 'speaker-selection', 'screen-wake-lock',
  'window-management', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen',
  'idle-detection', 'keyboardLock',
]);

const log = (...a) => { if (DEBUG) console.log('[electron-teams]', ...a); };

function estMicrosoft(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && DOMAINES_MICROSOFT.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch { return false; }
}

// Liens réécrits par Microsoft Defender (*.safelinks.protection.outlook.com?url=…) : domaine
// Microsoft, mais destination externe.
function estSafeLinks(url) {
  try { return new URL(url).hostname.endsWith('.safelinks.protection.outlook.com'); } catch { return false; }
}
// Adresse réelle d'un lien Safe Links, pour la copie.
function lienReel(url) {
  try { return estSafeLinks(url) ? new URL(url).searchParams.get('url') || url : url; } catch { return url; }
}

function ouvrirDansNavigateur(url) {
  log('navigateur :', url);
  if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
}

// Menu contextuel (Electron n'en a aucun par défaut) : liens, texte sélectionné, champs de saisie.
function menuContextuel(wc, p) {
  const modele = [];
  if (/^(https?|mailto):/.test(p.linkURL)) {
    modele.push(
      { label: 'Ouvrir le lien dans le navigateur', click: () => ouvrirDansNavigateur(p.linkURL) },
      { label: "Copier l'adresse du lien", click: () => clipboard.writeText(lienReel(p.linkURL).replace(/^mailto:/, '')) },
    );
  }
  if (p.isEditable && p.misspelledWord) {
    if (modele.length) modele.push({ type: 'separator' });
    for (const mot of p.dictionarySuggestions.slice(0, 5)) {
      modele.push({ label: mot, click: () => wc.replaceMisspelling(mot) });
    }
    modele.push({ label: 'Ajouter au dictionnaire', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
  }
  if (p.isEditable || p.selectionText.trim()) {
    if (modele.length) modele.push({ type: 'separator' });
    if (p.isEditable) modele.push({ label: 'Couper', role: 'cut', enabled: p.editFlags.canCut });
    modele.push({ label: 'Copier', role: 'copy', enabled: p.editFlags.canCopy });
    if (p.isEditable) modele.push({ label: 'Coller', role: 'paste', enabled: p.editFlags.canPaste });
  }
  if (modele.length) Menu.buildFromTemplate(modele).popup({ window: BrowserWindow.fromWebContents(wc) });
}

// Lien de réunion reçu en argument : msteams:/l/meetup-join/… ou https://teams.microsoft.com/l/…
function lienTeams(argv) {
  for (const a of argv) {
    if (/^msteams:/i.test(a)) return `https://teams.microsoft.com/${a.replace(/^msteams:\/*/i, '')}`;
    if (/^https:\/\//i.test(a) && estMicrosoft(a) && /\/l\//.test(a)) return a;
  }
  return null;
}

// Le WM_CLASS / app_id Wayland doit valoir « electron-teams » pour que KDE relie la fenêtre
// à electron-teams.desktop (icône, regroupement, bulle).
app.setName(NOM);
app.setDesktopName(`${NOM}.desktop`);
// Microsoft n'aime pas les navigateurs inconnus : on se présente comme un Chrome ordinaire.
app.userAgentFallback = app.userAgentFallback.replace(/ (electron-teams|Teams|Electron)\/\S+/g, '');

// Partage d'écran sous Wayland par PipeWire (sélecteur de KDE). Sonneries et sons de notification
// sans clic préalable. Touches multimédia laissées au système (pas de pause de Spotify par Teams).
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.exit(0);

let fenetre = null;
let zone = null;
let quitter = false;
let nonLus = -1;
let finDemarrage = Infinity;

function gdbus(args, rappel) {
  execFile('gdbus', args, (err, sortie) => {
    if (err) console.error('[electron-teams] gdbus :', err.message);
    else if (rappel) rappel(sortie);
  });
}

// --- Déconnexion ou extinction : KWin demande à chaque fenêtre de se fermer, puis attend.
// Ce n'est pas le moment de réduire : la fenêtre resterait et KWin afficherait « Les applications
// suivantes n'ont pas été fermées », avec une déconnexion forcée au bout de 2 minutes.
// ksmserver répond isShuttingDown = true pendant toute la fin de session (false hors KDE ou en cas d'erreur).
function finDeSession(rappel) {
  execFile('gdbus', ['call', '--session', '--dest', 'org.kde.ksmserver', '--object-path', '/KSMServer',
    '--method', 'org.kde.KSMServerInterface.isShuttingDown'], { timeout: 2000 },
  (err, sortie) => rappel(!err && /true/.test(sortie)));
}

// --- Fond orange du bouton dans la barre des tâches (« demande l'attention »).
// flashFrame d'Electron ne fait rien sous Wayland : on passe par un script KWin, chargé par D-Bus.
// KWin retire l'état tout seul quand la fenêtre est activée.
function demanderAttention() {
  const script = path.join(app.getPath('userData'), 'attention.js');
  fs.writeFileSync(script, `for (const w of workspace.windowList())
  if (w.desktopFileName === '${NOM}' && !w.active) w.demandsAttention = true;\n`);
  const kwin = ['call', '--session', '--dest', 'org.kde.KWin'];
  const nomScript = `${NOM}-attention`;
  gdbus([...kwin, '--object-path', '/Scripting', '--method', 'org.kde.kwin.Scripting.unloadScript', nomScript], () => {
    gdbus([...kwin, '--object-path', '/Scripting', '--method', 'org.kde.kwin.Scripting.loadScript', script, nomScript], (sortie) => {
      const id = /-?\d+/.exec(sortie)?.[0];
      if (!id || id === '-1') return;
      gdbus([...kwin, '--object-path', `/Scripting/Script${id}`, '--method', 'org.kde.kwin.Script.run'], () => {
        gdbus([...kwin, '--object-path', '/Scripting', '--method', 'org.kde.kwin.Scripting.unloadScript', nomScript]);
      });
    });
  });
}

// --- Bulle : signal com.canonical.Unity.LauncherEntry, que la barre des tâches de Plasma affiche.
// Fond orange en plus quand le nombre augmente (nouveau message) et que la fenêtre n'est pas au premier plan.
function majNonLus(n) {
  n = Math.max(0, Math.trunc(n) || 0);
  const hausse = Date.now() > finDemarrage && n > nonLus;
  if (n === nonLus) return;
  nonLus = n;
  log('non-lus :', n, hausse ? '(nouveau)' : '');
  if (hausse && fenetre && !fenetre.isFocused()) demanderAttention();
  const proprietes = n > 0 ? `{'count': <int64 ${n}>, 'count-visible': <true>}` : "{'count-visible': <false>}";
  gdbus(['emit', '--session', '--object-path', '/com/canonical/unity/launcherentry/1',
    '--signal', 'com.canonical.Unity.LauncherEntry.Update', `application://${NOM}.desktop`, proprietes]);
  if (zone) zone.setToolTip(n > 0 ? `Teams — ${n} non lu${n > 1 ? 's' : ''}` : 'Teams');
}

// --- Taille et position de la fenêtre, retenues d'une session à l'autre.
function lireEtatFenetre() {
  try { return JSON.parse(fs.readFileSync(FICHIER_FENETRE, 'utf8')); } catch { return { width: 1400, height: 900 }; }
}
function enregistrerEtatFenetre() {
  if (!fenetre || fenetre.isMinimized()) return;
  const etat = { ...fenetre.getNormalBounds(), maximise: fenetre.isMaximized() };
  try { fs.writeFileSync(FICHIER_FENETRE, JSON.stringify(etat)); } catch { /* sans importance */ }
}

function afficher() {
  if (!fenetre) return;
  if (fenetre.isMinimized()) fenetre.restore();
  fenetre.show();
  fenetre.focus();
}

function creerFenetre(masquee, url) {
  const etat = lireEtatFenetre();
  fenetre = new BrowserWindow({
    ...etat,
    show: false,
    title: 'Teams',
    icon: ICONE,
    autoHideMenuBar: true,
    backgroundColor: '#1b1b1b',
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      // Fenêtre réduite : ne pas ralentir la page, sinon sonneries et appels décrochent.
      backgroundThrottling: false,
    },
  });
  if (etat.maximise) fenetre.maximize();
  // Au démarrage de la session (--masquee) : fenêtre réduite, pour garder son bouton et sa bulle.
  fenetre.once('ready-to-show', () => {
    if (masquee) { fenetre.showInactive(); fenetre.minimize(); } else fenetre.show();
  });

  const wc = fenetre.webContents;

  // Nouvelles fenêtres : celles de Microsoft (connexion, conversation détachée) restent ici, le reste va dans le navigateur.
  wc.setWindowOpenHandler(({ url: cible }) => {
    if (cible === 'about:blank' || (estMicrosoft(cible) && !estSafeLinks(cible))) {
      log('fenêtre interne :', cible);
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICONE } };
    }
    ouvrirDansNavigateur(cible);
    return { action: 'deny' };
  });

  // Fenêtre ouverte vide puis dirigée vers un lien externe (ou Safe Links) : le lien part dans le navigateur
  // et la fenêtre se referme.
  wc.on('did-create-window', (enfant) => {
    enfant.webContents.on('will-navigate', (e) => {
      const depart = enfant.webContents.getURL();
      if (!e.isMainFrame || (depart && depart !== 'about:blank')) return;
      if (estMicrosoft(e.url) && !estSafeLinks(e.url)) return;
      e.preventDefault();
      ouvrirDansNavigateur(e.url);
      enfant.close();
    });
  });

  // Compteur : Teams place le nombre de non-lus en tête du titre, « (3) Conversation | … ».
  wc.on('page-title-updated', (_e, titre) => {
    log('titre :', titre);
    // Premier écran de Teams (« Conversation | Microsoft Teams ») : point de départ du compteur.
    if (finDemarrage === Infinity && / \| Microsoft Teams$/.test(titre)) finDemarrage = Date.now() + DELAI_DEMARRAGE_MS;
    const m = /^\((\d+)\)/.exec(titre);
    majNonLus(m ? Number(m[1]) : 0);
  });
  wc.on('did-navigate', (_e, adresse) => log('page :', adresse));
  // Rechargement ou connexion : nouveau point de départ.
  wc.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) finDemarrage = Infinity; });

  fenetre.on('close', (e) => {
    enregistrerEtatFenetre();
    if (quitter) return;
    // Réduire plutôt que cacher : le bouton de la barre des tâches (bulle, fond orange) reste visible.
    // Sauf en fin de session, où l'on quitte vraiment.
    e.preventDefault();
    finDeSession((oui) => {
      if (!oui) { if (fenetre && !fenetre.isDestroyed()) fenetre.minimize(); return; }
      log('fin de session : fermeture');
      quitter = true;
      app.quit();
    });
  });
  fenetre.on('resize', enregistrerEtatFenetre);
  fenetre.on('move', enregistrerEtatFenetre);

  wc.loadURL(url || URL_ACCUEIL);
}

function creerZoneNotification() {
  zone = new Tray(ICONE_ZONE);
  zone.setToolTip('Teams');
  zone.setContextMenu(Menu.buildFromTemplate([
    { label: 'Afficher Teams', click: afficher },
    { label: 'Recharger', click: () => fenetre && fenetre.webContents.reload() },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitter = true; app.quit(); } },
  ]));
  zone.on('click', () => (fenetre && fenetre.isVisible() && !fenetre.isMinimized() && fenetre.isFocused() ? fenetre.minimize() : afficher()));
}

app.on('second-instance', (_e, argv) => {
  const lien = lienTeams(argv);
  if (lien && fenetre) { log('lien reçu :', lien); fenetre.webContents.loadURL(lien); }
  afficher();
});
app.on('before-quit', () => { quitter = true; });
app.on('web-contents-created', (e, wc) => wc.on('context-menu', (ev, p) => menuContextuel(wc, p)));

app.whenReady().then(() => {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(app.userAgentFallback);
  ses.setSpellCheckerLanguages(['fr', 'en-US']);
  ses.setPermissionRequestHandler((wc, permission, rappel, details) => {
    const ok = PERMISSIONS.has(permission) && estMicrosoft(details.requestingUrl || wc.getURL());
    log('permission', permission, details.mediaTypes || '', ok ? 'accordée' : 'refusée');
    rappel(ok);
  });

  // Partage d'écran : sous Wayland avec WebRTCPipeWireCapturer, Chromium ouvre lui-même le sélecteur
  // de KDE (portail) sans passer par ici (constaté le 2026-10-19). Ce gestionnaire sert de secours :
  // getSources ouvre aussi le portail et renvoie la seule source choisie. Son système non partagé (preload.js).
  ses.setDisplayMediaRequestHandler((requete, rappel) => {
    if (!estMicrosoft(requete.securityOrigin || requete.frame?.url || '')) { rappel({}); return; }
    desktopCapturer.getSources({ types: ['screen', 'window'] })
      .then((sources) => {
        log('partage d\'écran :', sources.map((s) => s.name));
        rappel(sources.length ? { video: sources[0] } : {});
      })
      .catch((err) => { console.error('[electron-teams] partage d\'écran :', err.message); rappel({}); });
  });

  creerZoneNotification();
  creerFenetre(process.argv.includes('--masquee'), lienTeams(process.argv));
  majNonLus(0);
});
