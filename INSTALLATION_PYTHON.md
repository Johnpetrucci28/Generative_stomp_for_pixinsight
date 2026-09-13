# Installer Python (pour IA stomp)

Ce guide s'adresse à quelqu'un qui n'a jamais installé Python. Si tu sais
déjà que tu as Python 3.10 ou plus récent, tu peux passer directement à
l'étape 2 du `README.md`.

## 1. Vérifier si Python est déjà installé

Ouvre une invite de commandes (touche Windows, tape `cmd`, entrée) et
tape :

```
python --version
```

- Si ça affiche quelque chose comme `Python 3.11.4`, c'est bon, passe à
  l'étape 2 du `README.md` (à condition que le nombre après "3." soit
  10 ou plus).
- Si tu obtiens une erreur du genre *"python n'est pas reconnu en tant que
  commande interne..."*, Python n'est pas installé (ou pas accessible),
  continue ci-dessous.

## 2. Télécharger et installer Python (Windows)

1. Va sur **https://www.python.org/downloads/** (le site officiel --
   évite les autres sources).
2. Clique le gros bouton "Download Python 3.x.x" (la dernière version
   proposée convient).
3. Lance le fichier téléchargé (`python-3.x.x-amd64.exe`).
4. **Étape la plus importante** : sur le tout premier écran de
   l'installateur, coche la case en bas **"Add python.exe to PATH"**
   avant de cliquer sur "Install Now". C'est l'erreur la plus fréquente --
   sans cette case cochée, Windows ne saura pas où trouver Python depuis
   l'invite de commandes.
5. Laisse l'installation se terminer, puis ferme l'installateur.

## 3. Vérifier que ça a marché

Ouvre une **nouvelle** invite de commandes (ferme l'ancienne si elle était
déjà ouverte -- elle ne voit pas les changements faits pendant qu'elle
tournait) et retape :

```
python --version
pip --version
```

Les deux doivent afficher un numéro de version sans erreur. Si `python`
n'est toujours pas reconnu après avoir coché la case PATH, redémarre
l'ordinateur (Windows a parfois besoin de ça pour prendre en compte le
changement) puis retente.

## 4. Suite

Reviens au `README.md` de ce dossier, section "Installation", étape 2 :
créer l'environnement virtuel et installer les dépendances.

## macOS / Linux (non testé pour IA stomp, mais la logique est la même)

- macOS : Python 3 est parfois déjà présent (`python3 --version` dans le
  Terminal). Sinon, installe-le via **https://www.python.org/downloads/**
  ou `brew install python3` si tu as Homebrew.
- Linux : `python3 --version` -- quasiment toujours déjà installé. Sinon,
  passe par le gestionnaire de paquets de la distribution (`apt install
  python3 python3-venv`, `dnf install python3`, etc.).
