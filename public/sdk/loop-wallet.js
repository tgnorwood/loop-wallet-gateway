/* Loop Wallet SDK — "Log in with Loop Wallet" popup.
 * Usage:
 *   <script src="https://YOUR-HUB/sdk/loop-wallet.js"></script>
 *   const lw = LoopWallet.init({ appId: "APP_ID" });
 *   const { address, session_token } = await lw.login();
 *   const { signature } = await lw.signTypedData(typedData);
 *   const { transaction_hash } = await lw.execute([{ contractAddress, entrypoint, calldata }]);
 */
(function () {
  var HUB = (document.currentScript && new URL(document.currentScript.src).origin) || "";

  function b64url(bytes) {
    return btoa(String.fromCharCode.apply(null, Array.from(bytes)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function pkce() {
    var verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier: verifier, challenge: b64url(new Uint8Array(digest)) };
  }
  function openPopup(url) {
    var w = 420, h = 640;
    var left = window.screenX + (window.outerWidth - w) / 2;
    var top = window.screenY + (window.outerHeight - h) / 2;
    var p = window.open(url, "loop-wallet", "width=" + w + ",height=" + h + ",left=" + left + ",top=" + top);
    if (!p) throw new Error("Popup blocked. Call login() from a click handler.");
    return p;
  }
  function waitFor(popup, onMsg) {
    return new Promise(function (resolve, reject) {
      var timer = setInterval(function () {
        if (popup.closed) { cleanup(); reject(new Error("Popup closed")); }
      }, 500);
      function handler(e) {
        if (e.origin !== HUB || !e.data || e.data.source !== "loop-wallet") return;
        if (e.data.type === "cancel") { cleanup(); return reject(new Error("User cancelled")); }
        var r = onMsg(e.data);
        if (r !== undefined) { cleanup(); resolve(r); }
      }
      function cleanup() { clearInterval(timer); window.removeEventListener("message", handler); }
      window.addEventListener("message", handler);
    });
  }

  window.LoopWallet = {
    init: function (opts) {
      var hub = opts.hubUrl || HUB;
      HUB = hub;
      var origin = window.location.origin;
      return {
        login: async function () {
          var p = await pkce();
          var url = hub + "/connect?app=" + encodeURIComponent(opts.appId) +
            "&origin=" + encodeURIComponent(origin) + "&challenge=" + p.challenge;
          var popup = openPopup(url);
          var code = await waitFor(popup, function (d) { return d.type === "code" ? d.code : undefined; });
          var res = await fetch(hub + "/api/public/v1/oauth/token", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code: code, code_verifier: p.verifier }),
          });
          var json = await res.json();
          if (!res.ok) throw new Error(json.error || "Login failed");
          return json;
        },
        execute: async function (calls) {
          var url = hub + "/connect/sign?app=" + encodeURIComponent(opts.appId) + "&origin=" + encodeURIComponent(origin);
          var popup = openPopup(url);
          return waitFor(popup, function (d) {
            if (d.type === "ready") {
              popup.postMessage({ source: "loop-wallet-sdk", type: "execute_request", calls: calls }, hub);
              return undefined;
            }
            return d.type === "transaction" ? d : undefined;
          });
        },
        signTypedData: async function (typedData) {
          var url = hub + "/connect/sign?app=" + encodeURIComponent(opts.appId) + "&origin=" + encodeURIComponent(origin);
          var popup = openPopup(url);
          return waitFor(popup, function (d) {
            if (d.type === "ready") {
              popup.postMessage({ source: "loop-wallet-sdk", type: "sign_request", typedData: typedData }, hub);
              return undefined;
            }
            return d.type === "signature" ? d : undefined;
          });
        },
      };
    },
  };
})();
