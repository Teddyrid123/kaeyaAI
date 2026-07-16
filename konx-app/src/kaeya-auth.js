/*
 * Kaeya Auth — the login layer (talks to Supabase Auth / GoTrue over REST).
 *
 * This file holds ONLY the public "anon" key, which is designed to live inside
 * the app (it can't read or write anyone's data on its own — Row-Level Security
 * on the server enforces that). The real AI keys live on the server as secrets
 * and never come near this file.
 *
 * It exposes window.KaeyaAuth: signUp / signIn / signOut / getAccessToken /
 * isSignedIn / user / onChange. The session (login tokens) is kept in
 * localStorage so the user stays signed in between opens.
 */
;(function () {
  "use strict";

  var SUPABASE_URL = "https://jhtiaqlpfkzjxayqhrwi.supabase.co";
  // Public "anon" key — safe to ship inside the app.
  var ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpodGlhcWxwZmt6anhheXFocndpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMzcxNDcsImV4cCI6MjA5OTcxMzE0N30.LTQ9nmqyxOZdNTe5b4EPpLICjn6DuZBhQyFdaMozkhA";

  var AUTH = SUPABASE_URL + "/auth/v1";
  var SKEY = "kaeya-session";
  var listeners = [];

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SKEY) || "null"); } catch (e) { return null; }
  }
  function saveSession(s) {
    try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) {}
    notify();
  }
  function clearSession() {
    try { localStorage.removeItem(SKEY); } catch (e) {}
    notify();
  }
  function notify() {
    var s = loadSession();
    listeners.forEach(function (cb) { try { cb(s); } catch (e) {} });
  }

  // Turn a GoTrue token/signup response into our stored session shape.
  function normSession(d) {
    if (!d || !d.access_token) return null;
    var nowSec = Math.floor(Date.now() / 1000);
    var expAt = d.expires_at || (nowSec + (d.expires_in || 3600));
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token || "",
      expires_at: expAt,
      user: d.user || null
    };
  }

  function headers(bearer) {
    var h = { "Content-Type": "application/json", "apikey": ANON };
    if (bearer) h["Authorization"] = "Bearer " + bearer;
    return h;
  }

  function post(path, body, bearer) {
    return fetch(AUTH + path, {
      method: "POST",
      headers: headers(bearer),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; },
        function () { return { ok: r.ok, status: r.status, body: {} }; });
    });
  }

  function errFrom(res) {
    var b = res.body || {};
    var msg = b.msg || b.error_description || b.error || b.message || ("Something went wrong (" + res.status + ")");
    var e = new Error(msg);
    e.status = res.status;
    e.code = b.error_code || b.error || "";
    return e;
  }

  // ---- public actions -------------------------------------------------

  function signUp(email, password) {
    return post("/signup", { email: email, password: password }).then(function (res) {
      if (!res.ok) throw errFrom(res);
      var sess = normSession(res.body);
      if (sess) { saveSession(sess); return { signedIn: true, user: sess.user }; }
      // No token back => the project requires email confirmation.
      return { signedIn: false, confirm: true, email: email };
    });
  }

  function signIn(email, password) {
    return post("/token?grant_type=password", { email: email, password: password }).then(function (res) {
      if (!res.ok) throw errFrom(res);
      var sess = normSession(res.body);
      if (!sess) throw new Error("Sign in failed");
      saveSession(sess);
      return { signedIn: true, user: sess.user };
    });
  }

  function refresh() {
    var s = loadSession();
    if (!s || !s.refresh_token) return Promise.reject(new Error("no session"));
    return post("/token?grant_type=refresh_token", { refresh_token: s.refresh_token }).then(function (res) {
      if (!res.ok) { clearSession(); throw errFrom(res); }
      var sess = normSession(res.body);
      if (!sess) { clearSession(); throw new Error("refresh failed"); }
      saveSession(sess);
      return sess;
    });
  }

  // Returns a valid access token (refreshing if it's about to expire), or null.
  function getAccessToken() {
    var s = loadSession();
    if (!s) return Promise.resolve(null);
    var nowSec = Math.floor(Date.now() / 1000);
    if (s.expires_at && (s.expires_at - nowSec) > 60) return Promise.resolve(s.access_token);
    return refresh().then(function (ns) { return ns.access_token; }).catch(function () { return null; });
  }

  function signOut() {
    var s = loadSession();
    var done = Promise.resolve();
    if (s && s.access_token) done = post("/logout", {}, s.access_token).catch(function () {});
    return done.then(function () { clearSession(); });
  }

  // Build the provider consent URL (used later for Google/Facebook on desktop).
  function oauthUrl(provider, redirectTo) {
    var u = AUTH + "/authorize?provider=" + encodeURIComponent(provider);
    if (redirectTo) u += "&redirect_to=" + encodeURIComponent(redirectTo);
    return u;
  }

  window.KaeyaAuth = {
    url: SUPABASE_URL,
    anon: ANON,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    refresh: refresh,
    getAccessToken: getAccessToken,
    isSignedIn: function () { return !!loadSession(); },
    user: function () { var s = loadSession(); return s ? s.user : null; },
    onChange: function (cb) { if (typeof cb === "function") listeners.push(cb); },
    oauthUrl: oauthUrl
  };
})();
