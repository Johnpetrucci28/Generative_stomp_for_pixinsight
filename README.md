# IA stomp -- tampon génératif pour PixInsight

Peins une zone de ton image (halo résiduel, traînée de satellite, pixel
chaud...), clique "Tamponner" : le script régénère cette zone avec un
modèle d'inpainting génératif (LaMa, Apache 2.0) ou un algorithme
classique sans réseau de neurones, directement dans PixInsight.

Testé sur PixInsight 1.9.4 "Lockhart". Tout ce dont ce script a besoin
(à part Python lui-même) vit dans ce dossier `pixinsight/` -- il peut
être copié/partagé tel quel.

## Installation

1. **Python 3.10+** doit être installé sur la machine (Windows testé;
   macOS/Linux devraient fonctionner mais n'ont pas été testés). Pas
   encore installé, ou pas sûr ? Suis **`INSTALLATION_PYTHON.md`** dans ce
   dossier avant de continuer -- ce n'est pas forcément évident si tu ne
   l'as jamais fait.
2. Crée un environnement virtuel **à l'intérieur de ce dossier**, pour que
   le script le retrouve automatiquement :
   ```
   cd pixinsight
   python -m venv python/venv
   python/venv/Scripts/pip install -r python/requirements.txt
   ```
   (sur macOS/Linux : `python3 -m venv python/venv` puis
   `python/venv/bin/pip install -r python/requirements.txt`)
3. Ouvre `IAStomp.js` dans PixInsight : soit **Script > Execute Script...**
   et navigue jusqu'au fichier, soit glisse directement le fichier sur la
   fenêtre principale de PixInsight.
4. Au premier lancement, les chemins vers `python.exe` et `cli_stamp.py`
   sont détectés automatiquement si tu as suivi l'étape 2. Sinon, clique
   l'icône clé à molette en bas à gauche du dialogue pour les indiquer
   manuellement.

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
