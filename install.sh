#!/usr/bin/env bash
# Installe electron-teams pour l'utilisateur courant (aucun droit admin, rejouable).
# - lanceur ~/.local/share/applications/electron-teams.desktop (menu de Plasma) ;
# - icônes dans ~/.local/share/icons/hicolor ;
# - liens msteams: (réunions) ouverts dans electron-teams ;
# - démarrage avec la session, réduit dans la barre des tâches (sauf avec --sans-demarrage).
# Prérequis : sudo pacman -S --needed electron glib2
#
# Usage : ./install.sh [--sans-demarrage]      ./install.sh --desinstaller
set -euo pipefail

# En fin de script (réussite ou erreur), attendre une touche avant de rendre la main.
# Seulement au clavier : lancé par Claude ou dans un tube, pas de pause.
pause_finale() { [ -t 0 ] && [ -t 1 ] || return 0; echo; read -rsn1 -p "Appuie sur une touche pour terminer…" _ || true; echo; }
trap pause_finale EXIT

NOM=electron-teams
DOSSIER=$(cd "$(dirname "$0")" && pwd)
APPS=~/.local/share/applications
ICONES=~/.local/share/icons/hicolor
DEMARRAGE=~/.config/autostart

if [ "${1:-}" = --desinstaller ]; then
    rm -f "$APPS/$NOM.desktop" "$DEMARRAGE/$NOM.desktop" "$ICONES/scalable/apps/$NOM.svg"
    rm -f "$ICONES"/{32x32,64x64,256x256}/apps/$NOM.png
    update-desktop-database -q "$APPS" 2>/dev/null || true
    echo "✅ electron-teams désinstallé (la session Teams reste dans ~/.config/$NOM)."
    exit 0
fi

command -v electron >/dev/null || { echo "❌ Electron manquant : sudo pacman -S --needed electron"; exit 1; }
command -v gdbus >/dev/null || { echo "❌ gdbus manquant (bulle de non-lus) : sudo pacman -S --needed glib2"; exit 1; }

install -Dm644 "$DOSSIER/icones/$NOM.svg" "$ICONES/scalable/apps/$NOM.svg"
for t in 32 64 256; do
    install -Dm644 "$DOSSIER/icones/$NOM-$t.png" "$ICONES/${t}x${t}/apps/$NOM.png"
done

lanceur() {  # $1 = arguments en plus
    cat <<EOF
[Desktop Entry]
Type=Application
Name=Teams
GenericName=Messagerie et réunions
Comment=Microsoft Teams web dans une application Electron (appels, bulle de non-lus, zone de notification)
Exec=/usr/bin/electron "$DOSSIER"$1 %U
Icon=$ICONES/scalable/apps/$NOM.svg
StartupWMClass=$NOM
Categories=Network;InstantMessaging;Chat;VideoConference;
Keywords=chat;réunion;visio;microsoft;
MimeType=x-scheme-handler/msteams;
StartupNotify=true
EOF
}

lanceur "" > "$APPS/$NOM.desktop"
if [ "${1:-}" = --sans-demarrage ]; then
    rm -f "$DEMARRAGE/$NOM.desktop"
else
    mkdir -p "$DEMARRAGE"
    { lanceur " --masquee"; echo "X-KDE-autostart-phase=2"; } > "$DEMARRAGE/$NOM.desktop"
fi
update-desktop-database -q "$APPS" 2>/dev/null || true
# Liens « Ouvrir dans l'application Teams » (msteams:) des réunions.
xdg-mime default "$NOM.desktop" x-scheme-handler/msteams

echo "✅ electron-teams installé : menu de Plasma → Teams."
[ -f "$DEMARRAGE/$NOM.desktop" ] && echo "   Démarre avec la session, réduit dans la barre des tâches."
