# LivinLoop mobile

Expo SDK 52 + Expo Router. M2 shell: landing + camera capture.
Auth and photo upload wire through once the M2 backend's
`/api/listings/:id/photos/presign` endpoint is consumed from
here — deliberately scoped out of this commit so the shell can
live on its own.

## Local dev

```bash
cd mobile
npm install
npm start                # opens Expo Dev Tools
# Press i for iOS Simulator, a for Android emulator
```

The iOS Simulator camera shows a static fallback image. Test
camera capture on a real device via the Expo Go app or a
development build.

## Build (EAS)

```bash
npx eas login
npx eas build --platform ios --profile development
npx eas build --platform android --profile development
```

Bundle ID is `co.livinloop.app` (see `app.json`). EAS project
ID gets filled in on `eas init` the first time you run.

## What's wired up

- Expo Router with two screens: `/` (landing) and `/camera`
  (expo-camera capture + preview).
- Camera permission prompt with retry.
- Capture → preview → retake/use loop.

## What's not here yet

- Auth — magic-link from `web/`'s Auth.js + Resend, deep-linked
  back into the app via the `livinloop://` URL scheme.
- API client (fetch wrapper hitting `app.livinloop.co`).
- Photo upload — once auth lands, wire the camera's "Use photo"
  action to `POST /api/listings/:id/photos/presign` → PUT to R2
  → `POST /api/listings/:id/photos`.
- Listings list + new-listing form — port the screens from
  `web/src/app/listings/`.

## Carryover from LivAround

The camera capture pattern (expo-camera, capture + preview +
retake) mirrors `commercial/host-app/`'s photo flow. We'll port
the upload pipeline (presign + PUT + confirm) as M2 mobile-side
when we wire auth.
