// The map's layer control: L.Control.Layers plus one behavior — the overlay
// list is kept in two alphabetically-sorted sections, with the route overlays
// (RoutesLayer sets _routeOverlay on each route's layer group) grouped below
// a divider, separate from the charts. Ordering can't be left to insertion
// order: charts and routes are both added/removed dynamically as the view
// moves, so whichever scrolled into view last would otherwise land at the end
// of the list.
//
// Leaflet rebuilds the whole list on every add/remove (_update), so we
// post-process each rebuild: partition the labels into charts (plus any other
// non-route overlay, e.g. Seascape) and routes, sort each section by name,
// and re-append them with a separator in between (reusing Leaflet's own
// .leaflet-control-layers-separator styling, the same divider it draws
// between the base maps and the overlays). The base-map radio list is left
// untouched. This reads Leaflet-internal fields of the vendored leaflet.js
// (_overlaysList, input.layerId, _getLayer); the guards make a mismatch
// degrade to Leaflet's stock list rather than a broken control.

export const LayersControl = L.Control.Layers.extend({
  _update: function () {
    const result = L.Control.Layers.prototype._update.call(this);
    this._arrangeOverlays();
    return result;
  },

  _arrangeOverlays: function () {
    const list = this._overlaysList;
    if (!list || typeof this._getLayer !== "function")
      return;

    const others = [];
    const routes = [];
    for (const label of Array.from(list.children)) {
      const input = label.querySelector("input");
      const entry =
        input && input.layerId != null ? this._getLayer(input.layerId) : null;
      (entry?.layer?._routeOverlay ? routes : others).push(label);
    }

    const byName = (a, b) =>
      a.textContent.trim().localeCompare(b.textContent.trim());
    others.sort(byName);
    routes.sort(byName);

    // appendChild moves each label (checkbox listeners intact) into sorted
    // order. _update wiped the container, so any divider from the last render
    // is already gone; add a fresh one only when both sections are non-empty.
    for (const label of others)
      list.appendChild(label);
    if (others.length && routes.length) {
      const divider = document.createElement("div");
      divider.className = "leaflet-control-layers-separator";
      list.appendChild(divider);
    }
    for (const label of routes)
      list.appendChild(label);
  },
});
