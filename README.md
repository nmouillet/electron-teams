# electron-teams

Microsoft Teams web dans sa propre fenêtre sous Linux, avec l'**Electron des dépôts Arch**.
Fait pour KDE Plasma, sur le modèle d'[electron-outlook](https://github.com/nmouillet/electron-outlook).
Les techniques pour les appels viennent de [teams-for-linux](https://github.com/IsmaelMartinez/teams-for-linux),
mais le code est réécrit et bien plus court : pas de profils multiples, pas de MQTT, pas de mise à jour intégrée.

## Ce que ça apporte

| | PWA Chromium | teams-for-linux | electron-teams |
|---|---|---|---|
| Bulle de non-lus sur l'icône de la barre des tâches (KDE) | ❌ | ✅ | ✅ |
| Fond orange du bouton à l'arrivée d'un message | ❌ | ❌ | ✅ |
| Propre icône dans la barre des tâches | ❌ (celle de Chromium) | ✅ | ✅ |
| Appels, caméra, partage d'écran sous Wayland | ✅ | ✅ | ✅ |
| Correctifs de sécurité du moteur | pacman (`chromium`) | Electron embarqué | pacman (`electron`) |
| Taille du code à relire | — | très grande | ~250 lignes |

## Installation

```bash
sudo pacman -S --needed electron glib2
git clone https://github.com/nmouillet/electron-teams.git ~/Projets/_perso/electron-teams
~/Projets/_perso/electron-teams/install.sh            # avec démarrage automatique
~/Projets/_perso/electron-teams/install.sh --sans-demarrage
~/Projets/_perso/electron-teams/install.sh --desinstaller
```

`install.sh` ne demande aucun droit admin. Il crée `~/.local/share/applications/electron-teams.desktop`
(icône donnée par son chemin complet, voir plus bas), installe les icônes dans `~/.local/share/icons/hicolor`,
associe les liens `msteams:` (« Ouvrir dans l'application Teams ») à electron-teams et, sauf
`--sans-demarrage`, crée `~/.config/autostart/electron-teams.desktop` (lancement réduit, option `--masquee`).
Le lanceur pointe vers le dossier du dépôt : relancer `install.sh` si le dossier est déplacé.

## Fonctionnement

- **Compteur** : Teams met le nombre de non-lus en tête du titre de la page, « (3) Conversation | Microsoft Teams ».
  L'événement `page-title-updated` d'Electron suffit.
- **Bulle** : signal D-Bus `com.canonical.Unity.LauncherEntry.Update` pour `application://electron-teams.desktop`,
  émis avec `gdbus` (paquet `glib2`). La couleur de la bulle est la couleur d'accentuation de Plasma.
- **Fond orange** : quand le nombre augmente et que la fenêtre n'est pas au premier plan, un petit script KWin
  chargé par D-Bus met `demandsAttention` à vrai (`flashFrame` d'Electron ne fait rien sous Wayland).
  Le point de départ est pris 20 s après le premier écran de Teams, et repris à chaque rechargement : les messages
  déjà présents ne colorent pas le bouton.
- **Fermer, c'est réduire** : le bouton reste dans la barre des tâches, avec sa bulle. Pour quitter : clic droit
  sur l'icône de la zone de notification → *Quitter*.
- **Appels** :
  - micro, caméra, sortie audio, partage d'écran, écran gardé allumé : permissions accordées aux seuls domaines Microsoft ;
  - partage d'écran sous Wayland : option Chromium `WebRTCPipeWireCapturer`. Chromium ouvre le sélecteur
    d'écran de KDE (xdg-desktop-portal) ; `setDisplayMediaRequestHandler` ne sert qu'en secours ;
  - son du système retiré du partage d'écran (`preload.js`), pour éviter l'écho ;
  - `backgroundThrottling: false` et `autoplay-policy=no-user-gesture-required` : sonneries et appels
    fonctionnent fenêtre réduite ;
  - `HardwareMediaKeyHandling` désactivé : les touches multimédia restent au lecteur de musique.
- **Liens** : les fenêtres vers un domaine Microsoft restent dans l'application, les autres liens s'ouvrent
  dans le navigateur par défaut. Un lien `msteams:` ou `https://teams.microsoft.com/l/…` passé en argument
  est ouvert dans la fenêtre existante.
- **Identité du navigateur** : `Electron/…` est retiré de l'User-Agent, comme pour un Chrome ordinaire.
- **Sécurité** : `contextIsolation`, `sandbox`, pas de `nodeIntegration`.
- **Données** : session, cache et taille de la fenêtre dans `~/.config/electron-teams`.
- **Icône** : `Icon=` donne le chemin complet du SVG. Avec un nom (`Icon=electron-teams`), un thème qui
  contient une icône `electron` (Qogir, par exemple) l'emporterait, KDE coupant le nom au tiret.

Volontairement absent, contrairement à teams-for-linux : désactivation du GPU sous Wayland (pas de souci
constaté) et `use-fake-ui-for-media-stream` (les permissions passent par un filtre explicite).

## Diagnostic

```bash
ELECTRON_TEAMS_DEBUG=1 electron ~/Projets/_perso/electron-teams
```
Affiche les pages, les titres, les non-lus, les permissions demandées (accordées ou refusées) et les liens.

## Licence

Code : MIT (`LICENSE`). Icône : `teams-for-linux.svg` du thème Qogir (paquet EndeavourOS `eos-qogir-icons`),
GPL-3.0 (`icones/LICENSE`). Microsoft Teams est une marque de Microsoft ; ce projet personnel n'a aucun lien
avec Microsoft ni avec teams-for-linux.
