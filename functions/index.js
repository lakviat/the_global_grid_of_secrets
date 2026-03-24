const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const Stripe = require("stripe");

admin.initializeApp();
const db = admin.firestore();

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const ALLOWED_ORIGINS = new Set([
  "https://lockyoursecret.com",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

function safeDecode(value) {
  let decoded = String(value || "");
  // Handle plain text, encoded, and double-encoded payloads from query params.
  for (let idx = 0; idx < 2; idx += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch (error) {
      break;
    }
  }
  return decoded;
}

function parseClientReferenceId(referenceId) {
  const decoded = safeDecode(String(referenceId || "")).trim();
  const match = decoded.match(/^Secret:\s*([\s\S]*?)\s*\|\s*By:\s*(.+)$/i);

  if (match) {
    return {
      text: match[1].trim(),
      author: match[2].trim() || "Anonymous",
    };
  }

  return {
    text: decoded,
    author: "Anonymous",
  };
}

function guessCategory(secretText) {
  const text = String(secretText || "").toLowerCase();

  const guiltKeywords = ["sorry", "regret", "forgive", "apolog", "guilt", "ashamed", "missed"];
  const sadnessKeywords = ["lonely", "alone", "empty", "cry", "anxious", "sad", "depress", "hurt"];
  const joyKeywords = ["happy", "grateful", "joy", "miracle", "relief", "blessed", "smile", "kind"];

  if (guiltKeywords.some((word) => text.includes(word))) {
    return "guilt";
  }
  if (sadnessKeywords.some((word) => text.includes(word))) {
    return "sadness";
  }
  if (joyKeywords.some((word) => text.includes(word))) {
    return "joy";
  }

  return "general";
}

function setCorsHeaders(req, res) {
  const origin = req.get("origin") || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

exports.createCheckoutSession = onRequest(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY.value(), { apiVersion: "2024-06-20" });
    const body = req.body && typeof req.body === "object" ? req.body : {};

    const secretText = String(body.secretText || "").trim().slice(0, 200);
    const author = String(body.author || "").trim().slice(0, 40) || "Anonymous";
    const category = String(body.category || "").trim().toLowerCase() || "general";
    const siteUrl = String(body.siteUrl || "https://lockyoursecret.com").trim();

    if (!secretText) {
      res.status(400).json({ error: "Secret text is required" });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 199,
            product_data: {
              name: "Lock Your Secret",
              description: "Permanent confession post on The Global Grid of Secrets",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}?payment=success`,
      cancel_url: `${siteUrl}?payment=cancel`,
      metadata: {
        secret_text: secretText,
        author,
        category,
      },
    });

    res.status(200).json({ url: session.url });
  }
);

exports.stripeWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const signature = req.get("stripe-signature");
    if (!signature) {
      res.status(400).send("Missing stripe-signature header");
      return;
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY.value(), { apiVersion: "2024-06-20" });

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, signature, STRIPE_WEBHOOK_SECRET.value());
    } catch (error) {
      logger.error("Webhook signature verification failed", error);
      res.status(400).send(`Webhook Error: ${error.message}`);
      return;
    }

    if (event.type !== "checkout.session.completed") {
      res.status(200).send("Event ignored");
      return;
    }

    const session = event.data.object;
    const sessionId = session.id;
    const metadata = session.metadata || {};
    const clientReferenceId = session.client_reference_id || "";
    logger.info("checkout.session.completed received", {
      sessionId,
      hasClientReferenceId: Boolean(clientReferenceId),
      hasMetadataSecretText: Boolean(metadata.secret_text),
      paymentStatus: session.payment_status || "unknown",
    });

    const metadataText = String(metadata.secret_text || "").trim();
    const metadataAuthor = String(metadata.author || "").trim() || "Anonymous";
    const metadataCategory = String(metadata.category || "").trim().toLowerCase();

    const parsedReference = parseClientReferenceId(clientReferenceId);
    const text = metadataText || parsedReference.text;
    const author = metadataAuthor || parsedReference.author;
    const category = ["guilt", "sadness", "joy", "general"].includes(metadataCategory)
      ? metadataCategory
      : guessCategory(text);

    if (!text) {
      logger.warn("Session missing secret text", {
        sessionId,
        clientReferenceId,
        metadata,
      });
      res.status(200).send("No secret text provided");
      return;
    }

    const secretRef = db.collection("secrets").doc(sessionId);
    const existing = await secretRef.get();
    if (existing.exists) {
      res.status(200).send("Already processed");
      return;
    }

    await secretRef.set({
      text,
      author,
      category,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "stripe",
      stripeSessionId: sessionId,
      paymentStatus: session.payment_status || "unknown",
    });

    res.status(200).send("OK");
  }
);
