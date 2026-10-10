# Explorateur DVF – réplique

Réplique open source de l'onglet **Carte** de l'[explorateur des données de valeurs foncières](https://explore.data.gouv.fr/fr/immobilier?onglet=carte&filtre=tous) de data.gouv.fr : prix médian au m² et ventes immobilières des 5 dernières années, de la France entière jusqu'à la parcelle.

**Site publié :** https://agautrain.github.io/dataviz-immo/

## Fonctionnalités

- Carte choroplèthe du prix médian au m² qui s'affine avec le zoom : EPCI (France), communes (département), sections cadastrales (commune), puis parcelles vendues.
- Filtre par type de bien : appartements et maisons, maisons, appartements, locaux.
- Info-bulles au survol, légende, bascule plan / photographie aérienne, géolocalisation.
- Recherche d'adresse ou d'identifiant de parcelle (Géoplateforme IGN).
- Panneau latéral : nombre de ventes, prix médian, détail par type de bien, évolution mensuelle, distribution des prix, liens utiles.
- Au clic sur une parcelle : liste des mutations (prix, date, adresse, biens et surfaces), parcelles vendues ensemble, DPE et copropriété quand ils existent.
- L'URL garde le filtre et la position de la carte (`?filtre=maison&lat=…&lng=…&zoom=…`), on peut donc partager une vue.

## Architecture

Site 100 % statique (Vite + MapLibre GL + Chart.js, sans framework), sans backend : le navigateur interroge directement les services publics.

| Donnée | Source |
| --- | --- |
| Statistiques DVF (médianes, séries mensuelles, distributions, mutations) | [API DVF](https://github.com/datagouv/api-dvf) `https://dvf-api.data.gouv.fr`, alimentée par le [pipeline data.gouv.fr](https://github.com/datagouv/datagouvfr_data_pipelines/tree/main/data_processing/dvf) |
| Découpage administratif, cadastre | Tuiles vectorielles `openmaptiles.geo.data.gouv.fr` |
| Fond de carte, photos aériennes, géocodage | OpenMapTiles, Géoplateforme IGN |

```
src/
  api.js       appels à l'API DVF et au géocodeur (avec cache)
  map.js       carte, couches, niveaux de zoom, survol et clics
  sidebar.js   panneau latéral : statistiques, graphiques, mutations
  charts.js    courbe d'évolution et histogramme
  search.js    recherche d'adresse / parcelle
  state.js     état partagé (filtre, territoire courant)
  data/        style de carte et centres des départements (repris de l'original)
tests/smoke.mjs  test de bout en bout sur les données réelles
```

## Développement

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build de production dans dist/
```

`VITE_DVF_API` permet de pointer vers une autre instance de l'API DVF.

## Déploiement

Le workflow `.github/workflows/deploy.yml` construit le site et le publie sur GitHub Pages à chaque push sur `main` (Settings → Pages → Source : **GitHub Actions**). Le workflow `ci.yml` construit chaque PR et lance un test de fumée sur les vraies données.

## Crédits

Le style de carte, les centres des départements et les pictogrammes viennent de [datagouv/explore.data.gouv.fr](https://github.com/datagouv/explore.data.gouv.fr) (licence MIT, © 2018 Alexandre Bulté). Données DVF : DGFiP, Licence Ouverte. Ce projet n'est pas affilié à data.gouv.fr.
