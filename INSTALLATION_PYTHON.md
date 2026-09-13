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

## Pourquoi un "environnement virtuel" (venv) ?

Le `README.md` demande de créer un environnement virtuel
(`python -m venv python/venv`) plutôt que d'installer les bibliothèques
directement. Un venv est simplement un sous-dossier qui contient sa
propre copie isolée de Python et de ses paquets :

- ça évite d'installer PyTorch et les autres dépendances "en global" sur
  la machine, où elles pourraient entrer en conflit avec d'autres
  logiciels Python déjà présents (ou l'inverse, si une future
  désinstallation d'un autre outil casse IA stomp) ;
- ça place l'interpréteur `python.exe` à un chemin fixe et prévisible
  (`pixinsight/python/venv/Scripts/python.exe`), ce que le script
  `IAStomp.js` utilise pour le détecter automatiquement sans rien
  configurer ;
- supprimer IA stomp revient à supprimer le dossier `pixinsight/` --
  rien n'est éparpillé ailleurs sur le système.

Tu n'as jamais besoin d' "activer" ce venv manuellement (`activate.bat`
ou équivalent) : le script appelle directement
`python/venv/Scripts/python.exe`, ce qui revient au même sans avoir à
changer de terminal.

## Problèmes fréquents

- **`python` fonctionne mais `pip install -r ...` échoue tout de suite
  avec une erreur de chemin introuvable** : la commande doit être lancée
  depuis le dossier `pixinsight/` (celui qui contient `python/` et ce
  fichier), pas depuis un autre dossier -- les chemins `python/venv` et
  `python/requirements.txt` sont relatifs à l'endroit où tu tapes la
  commande.
- **L'installation semble bloquée plusieurs minutes sur `torch`** :
  normal, c'est de loin la plus grosse dépendance (plusieurs centaines
  de Mo) -- laisse-la terminer, surtout sur une connexion lente.
- **Erreur mentionnant "Microsoft Visual C++" ou un échec de compilation
  pendant `pip install`** : rare avec les versions récentes de Python
  (les paquets utilisés fournissent des binaires précompilés), mais si
  ça arrive, vérifie que `pip` lui-même est à jour avant de réessayer :
  `python/venv/Scripts/python.exe -m pip install --upgrade pip`.
- **Plusieurs versions de Python installées et `python --version` affiche
  une version trop ancienne** : utilise le lanceur Windows pour cibler la
  bonne version, par exemple `py -3.11 -m venv python/venv`.
- **Antivirus ou politique d'entreprise qui bloque l'exécution de
  `python.exe` lancé depuis PixInsight** : vérifie que le dossier
  `pixinsight/` n'est pas dans une zone restreinte (dossier synchronisé
  OneDrive avec accès contrôlé, par exemple) ; sinon, autorise
  explicitement `python/venv/Scripts/python.exe` dans l'antivirus.
