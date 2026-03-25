# Lock Your Secret

Live site: [lockyoursecret.com](https://lockyoursecret.com/)

Lock Your Secret is a permanent digital confessional. Anyone can read secrets for free. Posting a new secret costs $1.99. Once paid, the secret is written to the global wall and becomes part of a fixed archive that is intended to freeze forever at 100,000 entries.

The project is intentionally simple on the surface:

- Read secrets for free
- Pay $1.99 to lock in a confession
- Watch the wall grow in real time

Under the hood, the app uses a static frontend on GitHub Pages and a serverless backend on Firebase + Stripe.

## Product Idea

The core concept is scarcity plus anonymity.

Most anonymous confession products feel disposable. Lock Your Secret pushes in the opposite direction: each post is meant to feel final, public, and permanent. The wall is not an infinite stream. It is a limited public artifact with a hard cap.

That leads to a few product rules:

- Reading is frictionless and free
- Posting is intentional and paid
- Identity is optional and lightweight
- The archive is permanent once accepted
- The wall eventually closes at 100,000 entries

The UI is designed to feel dark, quiet, and slightly underground rather than playful or social-first.

## How It Works

1. A visitor opens the site and reads from the live secrets feed.
2. The visitor opens the submission modal and writes a secret.
3. The frontend sends the secret to a Firebase Cloud Function.
4. The Cloud Function creates a Stripe Checkout Session and stores the secret inside Stripe `metadata`.
5. Stripe handles payment.
6. Stripe sends a `checkout.session.completed` webhook to Firebase.
7. The webhook writes the paid secret into Firestore.
8. The frontend listens to Firestore in real time and renders the new entry automatically.

## Stack

- Frontend: static HTML, CSS, vanilla JavaScript
- Hosting: GitHub Pages
- Database: Firebase Firestore
- Backend: Firebase Cloud Functions
- Payments: Stripe Checkout + Stripe Webhooks

## Architecture

### Frontend

The frontend is a static site served from GitHub Pages. It is intentionally framework-free.

Relevant files:

- [index.html](/Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/index.html)
- [styles.css](/Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/styles.css)
- [script.js](/Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/script.js)

The client:

- renders the masonry-style secrets wall
- opens the confession modal
- loads secrets from Firestore
- listens for new secrets in real time
- calls the checkout-session function before redirecting to Stripe

### Backend

Firebase Functions handle payment-critical logic that should never live in the browser.

Relevant files:

- [functions/index.js](/Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/functions/index.js)
- [functions/package.json](/Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/functions/package.json)

Current responsibilities:

- create Stripe Checkout Sessions
- verify Stripe webhook signatures
- write paid secrets into Firestore
- support one-off local seed scripts

### Database

Firestore stores the public `secrets` collection.

Rules live in:

- [firestore.rules](/Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/firestore.rules)

The current rules allow public reads and block all client-side writes. Only admin-privileged backend code can write.

## Firestore Document Shape

Each secret document is expected to look roughly like this:

```json
{
  "text": "I still replay one argument from 2018 and wish I had apologized sooner.",
  "author": "Anonymous",
  "category": "guilt",
  "createdAt": "server timestamp",
  "source": "stripe"
}
```

Additional metadata may also be stored, such as:

- `stripeSessionId`
- `paymentStatus`

## Stripe Flow

The payment flow is intentionally backend-driven.

Why:

- Payment Links were not reliable for carrying the user’s secret text into Stripe.
- The production-safe solution is to create a Checkout Session on the backend and store the user payload in Stripe `metadata`.

Current production flow:

1. Browser submits `secretText`, `author`, and `category` to Firebase.
2. Firebase creates a Stripe Checkout Session.
3. Stripe `metadata` stores the secret payload.
4. After payment, Stripe triggers `checkout.session.completed`.
5. Firebase webhook verifies the event and writes the secret into Firestore.

## Local Development

From the repo root:

```bash
cd /Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets
```

To serve the static site locally, use any static server. For example:

```bash
python3 -m http.server 8080
```

Then open:

```bash
http://localhost:8080
```

## Firebase Setup

Login and select the correct project:

```bash
firebase login
firebase use --add
```

Deploy functions and Firestore rules:

```bash
firebase deploy --only functions,firestore:rules
```

### Secrets used by Functions

The backend expects these Firebase secret values:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Set them with:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase deploy --only functions
```

## Stripe Setup

Required webhook endpoint:

```text
https://us-central1-grid-of-secrets.cloudfunctions.net/stripeWebhook
```

Required event:

```text
checkout.session.completed
```

After adding the webhook in Stripe:

1. Reveal the webhook signing secret
2. Store it in Firebase:

```bash
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase deploy --only functions
```

## Seeding Production Data

This repo includes a one-off seed script:

- [functions/seed.js](/Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/functions/seed.js)

It writes 10 initial secrets into Firestore with:

- `createdAt: serverTimestamp()`
- `source: "seed"`

Run it with a service account:

```bash
cd /Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/functions
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/service-account.json"
export GOOGLE_CLOUD_PROJECT="grid-of-secrets"
npm install
npm run seed
```

## Deployment

The frontend is deployed via GitHub Pages.

Relevant files:

- [firebase.json](/Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/firebase.json)
- [.github/workflows/deploy.yml](/Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/.github/workflows/deploy.yml)
- [CNAME](/Users/nurlanmirovich/integration-automation/the_global_grid_of_secrets/CNAME)

Typical flow:

```bash
git add .
git commit -m "Update site"
git push origin main
firebase deploy --only functions
```

## SEO and Static Assets

The project also includes:

- embedded SVG favicon in the HTML head
- `robots.txt`
- `sitemap.xml`
- custom domain config through `CNAME`

## Current Constraints

- The wall is manually moderated only through payment acceptance and backend persistence
- There is no admin dashboard yet
- There is no moderation queue yet
- There is no automated fraud filtering yet
- Firestore reads are public by design

## Next Improvements

- Add a lightweight moderation/admin panel
- Add abuse filtering before Firestore writes
- Add analytics and conversion tracking
- Add archived milestone views as the wall grows
- Add a better loading skeleton for the masonry grid
- Add a dedicated success state after payment

## Project Status

This is an MVP with a production-facing architecture:

- static frontend
- realtime Firestore feed
- server-side Stripe session creation
- verified Stripe webhook persistence

The goal is not feature sprawl. The goal is a sharp, memorable, permanent-feeling product with a very clear loop: read, confess, pay, persist.
