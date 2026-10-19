'use strict';
// Partage d'écran : Teams demande aussi le son du système, que le portail Wayland ne fournit pas
// et qui ferait de l'écho dans l'appel. On ne partage que l'image (technique de teams-for-linux).
const { contextBridge } = require('electron');

contextBridge.executeInMainWorld({
  func: () => {
    const md = navigator.mediaDevices;
    if (!md || !md.getDisplayMedia) return;
    const original = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = (contraintes = {}) => original({ ...contraintes, audio: false });
  },
});
