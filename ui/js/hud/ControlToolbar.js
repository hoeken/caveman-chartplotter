// ControlToolbar owns the top control bar. All that lives there now is the
// Login button, shown to anonymous users so the login flow is discoverable
// without hunting for the settings gear. It builds its own DOM under the
// supplied parent; per-tick state comes from AppState via update(appState).
// Element IDs are preserved for CSS hooks in style.css;
// do not rename without updating it.

export class ControlToolbar {
  constructor({ parent, onLogin }) {
    this._onLogin = onLogin;

    this._container = document.createElement("div");
    this._container.id = "controlToolbar";
    this._container.innerHTML = `
      <div id="loginPrompt">
        <button id="loginButton">Login</button>
      </div>
    `;
    parent.appendChild(this._container);

    this._loginPrompt = this._container.querySelector("#loginPrompt");

    this._container
      .querySelector("#loginButton")
      .addEventListener("click", () => {
        // Log in within the app (see ChartPlotter.showLoginModal) rather than
        // bouncing to the SignalK admin SPA — that redirect never came back on
        // the Navico MFD.
        if (this._onLogin)
          this._onLogin();
      });
  }

  // Sessions that can't store their preferences get the Login button; once
  // logged in with write access the toolbar has nothing to show. A server with
  // security disabled has no login to offer, and its sessions can write
  // anyway, so the prompt stays hidden there too.
  update(appState) {
    const canWrite = appState.identity.canWrite();
    this._loginPrompt.style.display = canWrite ? "none" : "block";
  }

  // Whole-toolbar visibility, driven by the embedded URL param (see
  // ChartPlotter). This toggles only the container; update() manages the child
  // controls independently, so the two never fight.
  show() {
    this._container.style.display = "";
  }

  hide() {
    this._container.style.display = "none";
  }
}
