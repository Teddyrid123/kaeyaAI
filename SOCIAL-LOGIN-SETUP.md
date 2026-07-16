# Kaeya — "Sign in with Google" setup guide

The **code** for Google sign-in is done. But Google login only works after you flip a few
switches in two websites: **Google Cloud** (where you get Kaeya's Google login keys) and your
**Supabase dashboard** (where Kaeya's accounts live). This takes about **15 minutes**, and you
only do it **once**.

> ⚠️ **Never paste secret keys into this chat.** You'll type them straight into Supabase's
> website in Step 2 — that's the safe place for them.

---

## Step 1 — Get Kaeya's Google login keys (Google Cloud, ~10 min)

1. Go to **https://console.cloud.google.com** and sign in with your Google account.
2. At the very top, click the **project dropdown** → **New Project**. Name it **Kaeya** →
   **Create**. Wait a few seconds, then make sure that new "Kaeya" project is selected in the
   top dropdown.
3. In the search bar at the top, type **"OAuth consent screen"** and open it.
   - Choose **External** → **Create**.
   - **App name:** `Kaeya`. **User support email:** your email. **Developer contact email:**
     your email. Leave everything else blank → **Save and Continue**.
   - On the **Scopes** page, just click **Save and Continue**.
   - On the **Test users** page, click **+ Add users**, type **your own email**, → **Add** →
     **Save and Continue**. (While the app is in "testing", only emails you list here can sign
     in — that's fine for now. Adding your own email lets you test.)
4. In the search bar, type **"Credentials"** and open it.
   - Click **+ Create Credentials** (top) → **OAuth client ID**.
   - **Application type:** **Web application**. **Name:** `Kaeya web`.
   - Under **Authorized redirect URIs**, click **+ Add URI** and paste **exactly** this:
     ```
     https://jhtiaqlpfkzjxayqhrwi.supabase.co/auth/v1/callback
     ```
   - Click **Create**.
5. A box pops up with a **Client ID** and a **Client secret**. **Leave this tab open** — you'll
   copy both into Supabase in the next step. (You can reopen it later from the Credentials page.)

---

## Step 2 — Turn on Google in Supabase (~3 min)

1. Go to **https://supabase.com/dashboard** and open the **Kaeya AI** project.
2. Left sidebar → **Authentication** → **Providers** (or "Sign In / Providers").
3. Find **Google** in the list and click it. Turn it **ON** (the enable toggle).
4. Copy the **Client ID** from the Google tab and paste it into **Client ID** here.
   Copy the **Client secret** from Google and paste it into **Client Secret** here.
5. Click **Save**.

---

## Step 3 — Allow Kaeya's app to receive the login (~2 min)

Because Kaeya is a desktop app (not a website), it receives the finished login through a special
address that starts with `kaeya://`. We have to tell Supabase that address is allowed.

1. Still in Supabase → **Authentication** → **URL Configuration**.
2. Under **Redirect URLs**, click **Add URL** and add each of these (one at a time):
   ```
   kaeya://auth-callback
   kaeya://*
   ```
3. Click **Save**.

---

## Step 4 — Test it (on your machine)

1. Open the rebuilt Kaeya app (`konx-app\src-tauri\target\debug\konx-app.exe`).
2. Tap the floating orb so the sign-in screen appears.
3. Click **Continue with Google**. Your normal web browser should open to Google's sign-in.
4. Pick your Google account and approve.
5. Your browser will ask **"Open Kaeya?"** — click **Open** (tick "always allow" if offered).
6. Kaeya should jump to the front, the sign-in screen disappears, and you're in. Check
   **Settings → Account** — it should show your Google email.
7. Try a rewrite while signed in with Google to confirm everything works end to end.

**Tell me plainly how it went** — did the browser open? Did it come back and sign you in? If
anything stalled, tell me exactly what you saw on screen and I'll fix it.

---

### Notes
- The **first** time, Google may warn the app "isn't verified" (because it's brand new and in
  testing). Since you're a listed test user, click **Advanced → Go to Kaeya (unsafe)** to
  continue. We remove that warning later by "publishing" the consent screen before launch.
- **Facebook** login is intentionally still parked ("being finalized") — it needs a longer
  business/app review. We'll do it after Google is proven.
