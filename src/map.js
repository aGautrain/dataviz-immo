// Carte choroplèthe multi-échelles (EPCI -> communes -> sections -> parcelles),
// reprise de ChoroMap.vue de explore.data.gouv.fr.
import { Map as MapLibreMap, NavigationControl, GeolocateControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 charge son worker en module ES : on laisse Vite le bundler.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import baseStyle from "./data/vector-dvf.json";
import { api } from "./api.js";
import { choropleth, OUTSIDE_COLOR } from "./colors.js";
import {
  FILTERS, PLM, state, setLocation, subscribe, depOf, depName, depCenter, isNoDataArea,
} from "./state.js";

// Seuils de zoom identiques à l'original.
const ZOOM_DEP = 8;
const ZOOM_COM = 11;
const ZOOM_SECTION = 14;

// Couches du fond vectoriel masquées en mode photo aérienne.
const VECTOR_ONLY_LAYERS = [
  "background", "landcover-grass", "landcover-grass-park", "waterway_tunnel", "waterway-other",
  "waterway-other-intermittent", "waterway-stream-canal", "waterway-stream-canal-intermittent",
  "waterway-river", "waterway-river-intermittent", "water-offset", "water", "water-intermittent",
  "boundary-water",
];

const PARCEL_COLOR = "rgba(0, 0, 255, 0.2)";
const PARCEL_SELECTED = "rgba(255, 0, 0, 0.5)";
const PARCEL_LINKED = "rgba(255, 0, 0, 0.35)";

const levelForZoom = (z) =>
  z < ZOOM_DEP ? "fra" : z < ZOOM_COM ? "departement" : z < ZOOM_SECTION ? "commune" : "section";

const smallTerritory = (comCode, dep) =>
  ["751", "132", "693"].includes((comCode || "").substring(0, 3)) || ["75", "92", "93", "94"].includes(dep);

setWorkerUrl(maplibreWorkerUrl);

export function createMap({ container, tooltip, onLegend, initialView }) {
  const map = new MapLibreMap({
    container,
    style: structuredClone(baseStyle),
    center: initialView?.center ?? [2, 46.3],
    zoom: initialView?.zoom ?? 4.8,
    attributionControl: { compact: true },
  });
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.addControl(
    new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
    "top-right",
  );

  let ready = false;
  let currentData = []; // données du choroplèthe affiché (pour l'info-bulle)
  let renderToken = 0;
  let pendingParcel = initialView?.parcelle ?? null;

  map.on("load", () => {
    addLayers(map);
    bindInteractions();
    ready = true;
    refreshChoropleth();
    map.once("idle", () => {
      if (!pendingParcel) return updateLocationFromView();
      const id = pendingParcel;
      pendingParcel = null;
      selectParcel(id);
    });
  });

  // ---------------------------------------------------------------- couches
  function addLayers(m) {
    const before = "waterway-name"; // on garde les libellés au-dessus des aplats
    const add = (layer) => m.addLayer(layer, before);

    add({
      id: "epcis_fill", type: "fill", source: "decoupage-administratif", "source-layer": "epcis",
      paint: { "fill-color": OUTSIDE_COLOR, "fill-opacity": 0.8 },
    });
    add({
      id: "epcis_line", type: "line", source: "decoupage-administratif", "source-layer": "epcis",
      maxzoom: ZOOM_DEP,
      paint: { "line-color": "#000", "line-opacity": 0.5, "line-width": 0.5 },
    });
    add({
      id: "communes_fill", type: "fill", source: "decoupage-administratif-com", "source-layer": "communes",
      layout: { visibility: "none" },
      paint: { "fill-color": OUTSIDE_COLOR, "fill-opacity": 0.8 },
    });
    add({
      id: "communes_line", type: "line", source: "decoupage-administratif-com", "source-layer": "communes",
      minzoom: ZOOM_DEP - 1,
      paint: { "line-color": "#000", "line-opacity": 0.3, "line-width": 0.3 },
    });
    add({
      id: "sections_fill", type: "fill", source: "cadastre", "source-layer": "sections",
      minzoom: 10, layout: { visibility: "none" },
      paint: { "fill-color": "rgba(0,0,0,0)", "fill-opacity": 0.8 },
    });
    add({
      id: "sections_line", type: "line", source: "cadastre", "source-layer": "sections",
      minzoom: 10,
      paint: { "line-color": "#000", "line-opacity": 0.3, "line-width": 0.3 },
    });
    add({
      id: "parcelles_fill", type: "fill", source: "cadastre", "source-layer": "parcelles",
      minzoom: ZOOM_SECTION, filter: ["has", "dvf"],
      paint: { "fill-color": PARCEL_COLOR },
    });
    add({
      id: "parcelles_line", type: "line", source: "cadastre", "source-layer": "parcelles",
      minzoom: ZOOM_SECTION, filter: ["has", "dvf"],
      paint: { "line-color": "rgb(180,180,180)", "line-opacity": 0.6, "line-width": 0.3 },
    });

    // Couches invisibles servant au survol / clic / repérage du territoire au centre.
    const hit = (id, source, sourceLayer, extra = {}) =>
      m.addLayer({ id, type: "fill", source, "source-layer": sourceLayer, paint: { "fill-opacity": 0 }, ...extra });
    hit("departements_hit", "decoupage-administratif-dep", "departements");
    hit("communes_hit", "decoupage-administratif-com", "communes", { minzoom: ZOOM_DEP - 1 });
    hit("sections_hit", "cadastre", "sections", { minzoom: 10 });

    // Surbrillance du territoire survolé.
    m.addLayer({
      id: "hover_fill", type: "fill", source: "decoupage-administratif-dep", "source-layer": "departements",
      filter: ["==", ["get", "code"], ""], paint: { "fill-color": "#000", "fill-opacity": 0.15 },
    });
    m.addLayer({
      id: "hover_com_fill", type: "fill", source: "decoupage-administratif-com", "source-layer": "communes",
      filter: ["==", ["get", "code"], ""], paint: { "fill-color": "#000", "fill-opacity": 0.15 },
    });
    m.addLayer({
      id: "hover_section_fill", type: "fill", source: "cadastre", "source-layer": "sections",
      filter: ["==", ["get", "id"], ""], paint: { "fill-color": "#000", "fill-opacity": 0.15 },
    });
    // Contour blanc des territoires du niveau courant (comme l'original).
    m.addLayer({
      id: "current_com_line", type: "line", source: "decoupage-administratif-com", "source-layer": "communes",
      filter: ["==", ["get", "code"], ""], paint: { "line-color": "#fff", "line-width": 2 },
    });
    m.addLayer({
      id: "current_section_line", type: "line", source: "cadastre", "source-layer": "sections",
      filter: ["==", ["get", "id"], ""], paint: { "line-color": "#fff", "line-width": 2 },
    });
  }

  // ------------------------------------------------------- niveau courant
  const pickCommune = (features) => {
    // Paris/Lyon/Marseille : on préfère l'arrondissement à la commune « mère ».
    const list = features.filter((f) => !PLM.includes(f.properties.code));
    return list[0] ?? features[0];
  };

  function featureAtCenter(layer) {
    const p = map.project(map.getCenter());
    return map.queryRenderedFeatures([p.x, p.y], { layers: [layer] });
  }

  function updateLocationFromView() {
    if (!ready) return;
    const level = levelForZoom(map.getZoom());
    const loc = state.location;

    if (level === "fra") return setLocation({ level: "fra" });

    if (level === "departement") {
      const dep = featureAtCenter("departements_hit")[0]?.properties.code;
      if (dep) setLocation({ level: "departement", dep });
      return;
    }

    if (level === "commune") {
      const f = pickCommune(featureAtCenter("communes_hit"));
      if (f) {
        const com = f.properties.code;
        setLocation({ level: "commune", dep: depOf(com), com, comName: f.properties.nom });
      }
      return;
    }

    // Zoom parcellaire : une parcelle sélectionnée reste affichée tant qu'on reste à ce zoom.
    if (loc.level === "parcelle") return;
    const section = featureAtCenter("sections_hit")[0]?.properties.id;
    const comFeature = pickCommune(featureAtCenter("communes_hit"));
    const com = section ? section.substring(0, 5) : comFeature?.properties.code;
    if (!com) return;
    const comName = comFeature && comFeature.properties.code === com ? comFeature.properties.nom : loc.comName;
    setLocation({ level: "section", dep: depOf(com), com, comName, section: section ?? null });
  }

  map.on("moveend", () => {
    if (pendingParcel) {
      map.once("idle", () => {
        const id = pendingParcel;
        pendingParcel = null;
        selectParcel(id);
      });
      return;
    }
    // On attend que les tuiles du centre soient chargées pour interroger les couches.
    if (map.areTilesLoaded()) updateLocationFromView();
    else map.once("idle", updateLocationFromView);
  });

  // ------------------------------------------------------- choroplèthe
  async function refreshChoropleth() {
    if (!ready) return;
    const token = ++renderToken;
    const { level, dep, com } = state.location;
    const priceKey = FILTERS[state.filter].price;

    const show = (id, visible) => map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    show("epcis_fill", level === "fra");
    show("communes_fill", level === "departement");
    show("sections_fill", level === "commune");
    map.setFilter("current_com_line", ["==", ["get", "code"], ""]);
    map.setFilter("current_section_line", ["==", ["get", "id"], ""]);

    let rows = [];
    let layer = null;
    let property = "code";
    try {
      if (level === "fra") {
        rows = await api.epcis();
        layer = "epcis_fill";
      } else if (level === "departement" && dep) {
        rows = await api.communesOfDep(dep);
        layer = "communes_fill";
        map.setFilter("current_com_line", ["in", ["get", "code"], ["literal", rows.map((r) => r.c)]]);
      } else if (level === "commune" && com) {
        rows = await api.sectionsOfCommune(com);
        layer = "sections_fill";
        property = "id";
        map.setFilter("current_section_line", ["in", ["get", "id"], ["literal", rows.map((r) => r.c)]]);
      }
    } catch (err) {
      console.error(err);
      rows = [];
    }
    if (token !== renderToken) return; // une requête plus récente a pris le relais
    currentData = rows;

    if (!layer) {
      onLegend(null);
      return;
    }
    const { expression, legend } = choropleth(rows, priceKey, property);
    map.setPaintProperty(layer, "fill-color", expression);
    onLegend(legend);
  }

  // ------------------------------------------------------- interactions
  function bindInteractions() {
    // Survol : info-bulle avec prix médian et nombre de ventes.
    map.on("mousemove", (e) => {
      const level = state.location.level;
      let feature = null;
      let rowsPromise = null;
      let code = null;
      let label = null;

      if (level === "fra") {
        feature = map.queryRenderedFeatures(e.point, { layers: ["departements_hit"] })[0];
        if (feature) {
          code = feature.properties.code;
          label = feature.properties.nom;
          rowsPromise = api.departements();
          map.setFilter("hover_fill", ["==", ["get", "code"], code]);
        }
      } else if (level === "departement") {
        feature = pickCommune(map.queryRenderedFeatures(e.point, { layers: ["communes_hit"] }));
        if (feature && depOf(feature.properties.code) === state.location.dep) {
          code = feature.properties.code;
          label = feature.properties.nom;
          rowsPromise = Promise.resolve(currentData);
          map.setFilter("hover_com_fill", ["==", ["get", "code"], code]);
        }
      } else if (level === "commune") {
        feature = map.queryRenderedFeatures(e.point, { layers: ["sections_hit"] })[0];
        if (feature && feature.properties.id.startsWith(state.location.com)) {
          code = feature.properties.id;
          label = `Section ${feature.properties.code ?? code.substring(8)}`;
          rowsPromise = Promise.resolve(currentData);
          map.setFilter("hover_section_fill", ["==", ["get", "id"], code]);
        }
      }

      if (level !== "fra") map.setFilter("hover_fill", ["==", ["get", "code"], ""]);
      if (level !== "departement") map.setFilter("hover_com_fill", ["==", ["get", "code"], ""]);
      if (level !== "commune") map.setFilter("hover_section_fill", ["==", ["get", "id"], ""]);

      const clickable = map.queryRenderedFeatures(e.point, {
        layers: ["departements_hit", "communes_hit", "sections_hit", "parcelles_fill"].filter((l) => map.getLayer(l)),
      }).length;
      map.getCanvas().style.cursor = clickable ? "pointer" : "";

      if (!rowsPromise) return tooltip.hide();
      tooltip.show(e.point, { label, loading: true });
      rowsPromise.then((rows) => {
        const row = rows.find((r) => r.c === code);
        const f = FILTERS[state.filter];
        tooltip.show(e.point, {
          label: row?.n && level !== "commune" ? row.n : label,
          price: row?.[f.price],
          count: row?.[f.count],
          noData: isNoDataArea(code),
        });
      }).catch(() => tooltip.show(e.point, { label, error: true }));
    });

    map.getCanvas().addEventListener("mouseleave", () => {
      tooltip.hide();
      map.setFilter("hover_fill", ["==", ["get", "code"], ""]);
      map.setFilter("hover_com_fill", ["==", ["get", "code"], ""]);
      map.setFilter("hover_section_fill", ["==", ["get", "id"], ""]);
    });

    // Clic : on descend d'un niveau en zoomant sur le territoire cliqué.
    map.on("click", (e) => {
      const z = map.getZoom();
      if (z < ZOOM_DEP) {
        const f = map.queryRenderedFeatures(e.point, { layers: ["departements_hit"] })[0];
        if (!f) return;
        const dep = f.properties.code;
        map.flyTo({ center: depCenter(dep) ?? e.lngLat, zoom: 9 + (["75", "92", "93", "94"].includes(dep) ? 1.8 : 0) });
      } else if (z < ZOOM_COM) {
        const f = pickCommune(map.queryRenderedFeatures(e.point, { layers: ["communes_hit"] }));
        if (!f) return;
        const com = f.properties.code;
        map.flyTo({ center: e.lngLat, zoom: smallTerritory(com, depOf(com)) ? 13.5 : 12 });
      } else if (z < ZOOM_SECTION) {
        const f = map.queryRenderedFeatures(e.point, { layers: ["sections_hit"] })[0];
        if (!f) return;
        const com = f.properties.id.substring(0, 5);
        map.flyTo({ center: e.lngLat, zoom: smallTerritory(com, depOf(com)) ? 16 : 15 });
      } else {
        const f = map.queryRenderedFeatures(e.point, { layers: ["parcelles_fill"] })[0];
        if (f) selectParcel(f.properties.id);
      }
    });
  }

  // ------------------------------------------------------- parcelles
  function selectParcel(id) {
    const com = id.substring(0, 5);
    const comFeature = pickCommune(featureAtCenter("communes_hit"));
    const comName = comFeature?.properties.code === com ? comFeature.properties.nom : state.location.comName;
    setLocation({ level: "parcelle", dep: depOf(com), com, comName, section: id.substring(0, 10), parcelle: id });
    highlightParcels(id, []);
  }

  function highlightParcels(selected, linked) {
    if (!ready) return;
    if (!selected) return map.setPaintProperty("parcelles_fill", "fill-color", PARCEL_COLOR);
    const expr = ["match", ["get", "id"], selected, PARCEL_SELECTED];
    [...new Set(linked)].filter((p) => p !== selected).forEach((p) => expr.push(p, PARCEL_LINKED));
    expr.push(PARCEL_COLOR);
    map.setPaintProperty("parcelles_fill", "fill-color", expr);
  }

  // ------------------------------------------------------- réactions à l'état
  let lastKey = "";
  subscribe((s) => {
    const key = `${s.filter}|${s.location.level}|${s.location.dep}|${s.location.com}`;
    if (key !== lastKey) {
      lastKey = key;
      refreshChoropleth();
    }
    if (s.location.level !== "parcelle") highlightParcels(null);
  });

  // ------------------------------------------------------- API publique
  let ortho = false;
  return {
    map,
    flyToAddress(coordinates) {
      map.flyTo({ center: coordinates, zoom: 16 });
    },
    flyToParcel(id, coordinates) {
      pendingParcel = id;
      map.flyTo({ center: coordinates, zoom: 17 });
    },
    highlightParcels,
    toggleOrtho() {
      ortho = !ortho;
      map.setLayoutProperty("simple-tiles", "visibility", ortho ? "visible" : "none");
      VECTOR_ONLY_LAYERS.forEach((id) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", ortho ? "none" : "visible");
      });
      return ortho;
    },
    depLabel: depName,
  };
}
