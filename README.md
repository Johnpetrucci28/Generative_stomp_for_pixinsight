# IA stomp -- tampon génératif pour PixInsight

Peins une zone de ton image (halo résiduel, traînée de satellite, pixel
chaud...), clique "Tamponner" : le script régénère cette zone avec un
modèle d'inpainting génératif (LaMa, Apache 2.0) ou un algorithme
classique sans réseau de neurones, directement dans PixInsight.

Testé sur PixInsight 1.9.4 "Lockhart". Tout ce dont ce script a besoin
(à part Python lui-même) vit dans ce dossier `pixinsight/` -- il peut
être copié/partagé tel quel.

## Ce que l'outil produit dans PixInsight, et pourquoi c'est intéressant

Concrètement, dans PixInsight tu obtiens une nouvelle entrée de menu
**Script** qui ouvre un dialogue de type "process" : un aperçu de ton
image avec un pinceau, quelques réglages, et deux boutons clés
("Tamponner" et "Appliquer à l'image"). Pas de nouvelle fenêtre d'image
séparée à gérer, pas de fichier intermédiaire à retrouver sur le disque --
tout se passe dans ce dialogue, sur une copie de travail interne, jusqu'à
ce que tu décides explicitement de valider.

Pourquoi ça vaut le coup par rapport aux outils déjà présents dans
PixInsight (`CloneStamp`, `PixelMath`, `RepairedGrid`...) ou dans un éditeur
photo classique :

- **Génératif, pas juste un clonage/interpolation** : la zone effacée est
  reconstruite par un vrai modèle d'inpainting (LaMa) qui a appris à
  halluciner une texture plausible à partir du contexte -- pas une simple
  copie de pixels voisins ou un flou directionnel. Sur un halo résiduel,
  une trainée de satellite ou une étoile chaude au milieu d'un fond de
  ciel structuré, le résultat se fond nettement mieux qu'un clone stamp
  manuel.
- **Travaille en données linéaires**, directement sur les valeurs brutes
  du signal (avant tout étirement d'histogramme) -- c'est le moment du
  traitement où ce genre de défaut doit normalement être corrigé, avant
  qu'un étirement non-linéaire n'amplifie le bruit et les artefacts. Le
  bouton "STF auto" permet de visualiser un aperçu étiré pendant qu'on
  peint, sans jamais toucher aux données réelles sous-jacentes.
- **Non destructif tant que tu n'as pas cliqué "Appliquer"** : chaque
  tampon (un coup de pinceau + génération) se fait sur une copie de
  travail, pas sur l'image ouverte. Tu peux enchaîner plusieurs tampons,
  annuler le dernier, comparer, avant de valider -- ou fermer le dialogue
  sans rien avoir changé. Une fois "Appliquer à l'image" cliqué, c'est un
  seul geste, annulable normalement via le Ctrl+Z de PixInsight.
- **Conserve tout ce que PixInsight attend d'une image** : dimensions,
  nombre de canaux, et surtout les métadonnées (données astrométriques,
  en-têtes FITS/XISF) qui seraient perdues si on passait par un export/
  réimport dans un éditeur externe. Le pont vers Python ne touche qu'aux
  pixels, jamais aux propriétés de l'image ou de la fenêtre.
- **Deux moteurs au choix** : LaMa pour la qualité (réseau de neurones,
  fonctionne sur CPU, pas besoin de carte graphique dédiée), ou un
  algorithme classique OpenCV pour un résultat instantané sans
  téléchargement de modèle -- utile pour un test rapide ou une machine
  sans connexion internet après la première installation.
- **S'intègre comme les autres process PixInsight** : icône "New Instance"
  glissable dans l'espace de travail, réglages mémorisés d'une session à
  l'autre, raccourcis souris cohérents avec les habitudes de l'interface
  (Ctrl pour soustraire, Ctrl+clic droit pour ajuster un paramètre).

## Installation

1. **Python 3.10 ou plus récent** doit être installé sur la machine
   (Windows testé; macOS/Linux devraient fonctionner mais n'ont pas été
   testés). C'est le seul prérequis externe à ce dossier -- PixInsight
   lui-même ne fournit pas de Python utilisable pour ça, et le script y
   fait appel via un processus externe (`ExternalProcess`) pour déléguer
   le calcul d'inpainting.

   Pas encore installé, ou pas sûr ? Suis **`INSTALLATION_PYTHON.md`**
   dans ce dossier avant de continuer -- ce n'est pas forcément évident
   si tu ne l'as jamais fait, et le guide détaille chaque étape avec les
   pièges courants (notamment la case "Add python.exe to PATH", l'erreur
   la plus fréquente).
2. Crée un environnement virtuel **à l'intérieur de ce dossier**, pour que
   le script le retrouve automatiquement. Un environnement virtuel
   (`venv`) est un dossier Python isolé : les bibliothèques installées à
   l'étape suivante (PyTorch, OpenCV, etc.) restent confinées à ce
   dossier `pixinsight/python/venv`, sans rien modifier à l'installation
   Python globale de la machine ni entrer en conflit avec d'autres
   projets Python déjà présents. C'est aussi ce qui permet à `IAStomp.js`
   de retrouver l'interpréteur automatiquement, à un chemin prévisible.

   Ouvre une invite de commandes dans ce dossier (`pixinsight/`) et
   tape :
   ```
   python -m venv python/venv
   python/venv/Scripts/pip install -r python/requirements.txt
   ```
   (sur macOS/Linux : `python3 -m venv python/venv` puis
   `python/venv/bin/pip install -r python/requirements.txt`)

   Cette installation télécharge notamment PyTorch (le moteur de calcul
   de LaMa) : compte plusieurs centaines de Mo et quelques minutes selon
   la connexion -- c'est normal, c'est une opération à faire une seule
   fois. Les poids du modèle LaMa lui-même (~200 Mo) seront téléchargés
   séparément, automatiquement, au tout premier tampon généré (voir
   `LICENSES.md`).

   Si `pip install` échoue avec une erreur, vérifie d'abord que la
   commande a bien été lancée **depuis le dossier `pixinsight/`** (les
   chemins `python/venv` et `python/requirements.txt` sont relatifs) --
   c'est la cause la plus fréquente d'échec à cette étape.
3. Ouvre `IAStomp.js` dans PixInsight : soit **Script > Execute Script...**
   et navigue jusqu'au fichier, soit glisse directement le fichier sur la
   fenêtre principale de PixInsight.
4. Au premier lancement, les chemins vers `python.exe` et `cli_stamp.py`
   sont détectés automatiquement si tu as suivi l'étape 2. Sinon, clique
   l'icône clé à molette en bas à gauche du dialogue pour les indiquer
   manuellement (`python.exe` se trouve dans
   `pixinsight/python/venv/Scripts/`, et `cli_stamp.py` dans
   `pixinsight/python/stomp/`).

Astuce : clique l'icône "New Instance" (le triangle bleu, à côté de la
clé à molette) puis glisse-la vers ton espace de travail PixInsight pour
créer une icône de processus qui rouvre l'outil avec tes réglages
mémorisés -- plus besoin de rouvrir le script à chaque fois.

## Utilisation

- **Glisser** (clic gauche) : peindre la zone à régénérer.
- **Ctrl+glisser** : retirer de la sélection.
- **Ctrl+clic droit+glisser** : ajuster le diamètre du pinceau.
- **Molette** : zoom (centré sur le curseur).
- **Tamponner** : génère le résultat sur une copie de travail interne --
  rien n'est encore appliqué à l'image réelle.
- **Appliquer à l'image** : valide tous les tampons de la session sur
  l'image réelle, en un seul geste annulable (Ctrl+Z dans PixInsight).
- **Annuler dernier tampon** : annule uniquement le dernier tampon sur la
  copie de travail (un seul niveau), avant d'appliquer.

Réglages : taille du pinceau (jusqu'à 300px), opacité, fondu (adouci du
bord, en % du rayon de la zone peinte), moteur (LaMa ou classique), et
"STF auto" pour visualiser l'aperçu étiré même si l'image réelle est
encore linéaire (n'affecte jamais les données réelles).

## Limites connues

- Fonctionne sur des données **linéaires** (avant tout étirement
  d'histogramme).
- Sur un très grand tampon en un seul geste (rayon > ~150-200px), le
  résultat peut rester légèrement reconnaissable comme une zone retouchée
  (plafond de qualité du modèle sur les très grands trous). Le meilleur
  résultat s'obtient en tamponnant en **plusieurs passes plus petites qui
  se chevauchent** plutôt qu'un seul geste géant.
- Pas de support direct des fichiers FITS en dehors de PixInsight (le
  pont Python travaille uniquement via les échanges internes du script).

## Licence

Le code de ce projet est sous licence **MIT** (voir `LICENSE`). Les
dépendances tierces (LaMa, OpenCV) sont détaillées dans `LICENSES.md` --
toutes deux en Apache 2.0, aucune donnée d'entraînement propriétaire,
poids téléchargés automatiquement au premier lancement (connexion
internet requise une seule fois).
