'use strict';
// Partage d'écran : Teams demande aussi le son du système, que le portail Wayland ne fournit pas
// et qui ferait de l'écho dans l'appel. On ne partage que l'image (technique de teams-for-linux).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.executeInMainWorld({
  func: () => {
    const md = navigator.mediaDevices;
    if (!md || !md.getDisplayMedia) return;
    const original = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = (contraintes = {}) => original({ ...contraintes, audio: false });
  },
});

// Clic sur une notification système : Teams ouvre la conversation, mais son window.focus() laisse la fenêtre réduite.
// Chaque notification de la page signale son clic par un événement de window (DOM commun aux deux mondes), relayé à
// main.js qui remet la fenêtre au premier plan. Electron n'affiche pas les notifications du service worker de Teams :
// toutes passent par ce constructeur.
const CLIC_NOTIFICATION = 'electron-teams-notification-cliquee';
contextBridge.executeInMainWorld({
  func: (evenement) => {
    const Origine = window.Notification;
    if (!Origine) return;
    window.Notification = class Notification extends Origine {
      constructor(titre, options) {
        super(titre, options);
        this.addEventListener('click', () => window.dispatchEvent(new Event(evenement)));
      }
    };
  },
  args: [CLIC_NOTIFICATION],
});
window.addEventListener(CLIC_NOTIFICATION, () => ipcRenderer.send('notification-cliquee'));

// Statut de disponibilité : lu dans Teams (attributs aria-label et title), envoyé à main.js pour la pastille
// de la zone de notification. Seule la page principale l'envoie, pas les cadres intégrés.
const INTERVALLE_PRESENCE_MS = 5000;
// Lectures sans statut à suivre avant de le considérer absent : évite de changer d'icône pendant un redessin de l'en-tête.
const LECTURES_SANS_STATUT = 3;
// Sources du statut, de la plus précise à la plus générale : une source n'est lue que si la précédente ne donne rien.
// Les attributs data-tid de Teams peuvent changer ; la dernière source repère tout élément dont le libellé annonce un statut.
const SOURCES_PRESENCE = [
  '[data-tid="me-control-avatar-presence"]',
  '[data-tid="me-control-avatar-trigger"]',
  '[data-tid*="presence" i]',
  '[data-tid*="me-control" i]',
  '[aria-label*="statut" i]',
];
// Mots-clés sans accents ni majuscules, en français et en anglais, de chaque statut Teams. Les statuts les plus
// précis passent avant ceux dont le mot figure dans leur libellé (« Apparaître absent » avant « absent »).
const STATUTS = [
  { statut: 'disponible', mots: ['disponible', 'available'] },
  { statut: 'apparaitre-absent', mots: ['apparaitre absent', 'appear away'] },
  { statut: 'de-retour', mots: ['de retour', 'be right back', 'berightback'] },
  { statut: 'absent', mots: ['absent', 'away'] },
  { statut: 'hors-bureau', mots: ['hors bureau', 'out of office', 'outofoffice'] },
  { statut: 'occupe', mots: ['occupe', 'busy'] },
  { statut: 'en-appel', mots: ['en appel', 'in a call', 'inacall'] },
  { statut: 'en-reunion', mots: ['en reunion', 'in a meeting', 'inameeting'] },
  { statut: 'presentation', mots: ['presentation', 'presenting'] },
  { statut: 'ne-pas-deranger', mots: ['ne pas deranger', 'do not disturb', 'donotdisturb'] },
  { statut: 'concentration', mots: ['concentration', 'focusing'] },
  { statut: 'hors-ligne', mots: ['hors ligne', 'offline', 'apparaitre hors connexion'] },
  { statut: 'inconnu', mots: ['unknown', 'inconnu'] },
];

function lirePresence() {
  for (const selecteur of SOURCES_PRESENCE) {
    for (const el of document.querySelectorAll(selecteur)) {
      const texte = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`
        .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
      const trouve = STATUTS.find(({ mots }) => mots.some((mot) => new RegExp(`\\b${mot}\\b`).test(texte)));
      if (trouve) return trouve.statut;
    }
  }
  return null;
}

if (window.top === window) {
  let dernier;
  let sansStatut = 0;
  setInterval(() => {
    const lu = lirePresence();
    sansStatut = lu === null ? sansStatut + 1 : 0;
    const statut = lu === null && sansStatut < LECTURES_SANS_STATUT ? dernier : lu;
    if (statut === dernier) return;
    dernier = statut;
    ipcRenderer.send('presence', statut);
  }, INTERVALLE_PRESENCE_MS);
}
