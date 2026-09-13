# Dependances externes -- IA stamp

Conformement a la politique de licence HaloNet (donnees d'entrainement
maison uniquement, aucun poids/code/dataset externe sans validation
explicite), voici ce que ce sous-projet utilise et sous quelle licence.

## LaMa / big-lama (poids pre-entraines)

- Source: saic-mdal/lama (Samsung AI Center Moscow), licence **Apache 2.0**.
- Poids recuperes via le wrapper `simple-lama-inpainting` (MIT), qui
  telecharge le fichier torchscript `big-lama.pt` depuis
  https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt
  au premier lancement (cache local: `~/.cache/torch/hub/checkpoints/`).
- Entraine sur Places2 (photos naturelles) -- pas de donnees astro. C'est
  un remplisseur de structure generique, pas un modele specialise sur le
  ciel/bruit de capteur.
- Valide explicitement par l'utilisateur le 2026-09-12 pour un usage qui
  sera open source (aspect commercial secondaire ici, contrairement au
  reste de HaloNet).

## OpenCV (repli classique)

- `opencv-python-headless`, licence Apache 2.0. Algorithmes Telea /
  Navier-Stokes, aucune donnee externe, aucun poids.
