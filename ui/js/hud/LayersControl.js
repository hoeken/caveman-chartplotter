// The map's layer control: L.Control.Layers plus two behaviors.
//
// One: the list is split into three labeled sections — "Base Layer" above
// the base-map radios, "Charts + Overlays" above the chart overlays (plus
// any other non-route overlay, e.g. Seascape), and "Routes" above the route
// overlays (RoutesLayer sets _routeOverlay on each route's layer group).
// The headers stand in for Leaflet's stock separator line, so that is
// hidden. Each header is styled by .leaflet-control-layers-section (see
// style.css): bold text with a rule filling the rest of the row, vertically
// centered on the text.
//
// Two: the two overlay sections are kept alphabetically sorted. Ordering
// can't be left to insertion order: charts and routes are both added/removed
// dynamically as the view moves, so whichever scrolled into view last would
// otherwise land at the end of the list.
//
// Leaflet rebuilds the whole list on every add/remove (_update), so we
// post-process each rebuild: partition the labels into charts and routes,
// sort each section by name, and re-append them under their headers. This
// reads Leaflet-internal fields of the vendored leaflet.js (_baseLayersList,
// _overlaysList, _separator, input.layerId, _getLayer); the guards make a
// mismatch degrade to Leaflet's stock list rather than a broken control.

export const LayersControl = L.Control.Layers.extend({
  _update: function () {
    const result = L.Control.Layers.prototype._update.call(this);
    this._arrangeOverlays();
    this._labelBaseLayers();
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
    // order. _update wiped the container, so the headers from the last render
    // are already gone; a section gets its header only when it's non-empty.
    if (others.length)
      list.appendChild(this._makeHeader("Charts + Overlays"));
    for (const label of others)
      list.appendChild(label);
    if (routes.length)
      list.appendChild(this._makeHeader("Routes"));
    for (const label of routes)
      list.appendChild(label);
  },

  _labelBaseLayers: function () {
    // The headers stand in for the base/overlay divider; Leaflet re-decides
    // the separator's display on every _update, so re-hide it each time.
    if (this._separator)
      this._separator.style.display = "none";
    const list = this._baseLayersList;
    if (list && list.children.length)
      list.insertBefore(this._makeHeader("Base Layer"), list.firstChild);
  },

  _makeHeader: function (text) {
    const header = document.createElement("div");
    header.className = "leaflet-control-layers-section";
    header.textContent = text;
    return header;
  },
});
