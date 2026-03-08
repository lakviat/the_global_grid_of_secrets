const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const Stripe = require("stripe");

admin.initializeApp();
const db = admin.firestore();

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
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
    const clientReferenceId = session.client_reference_id || "";

    const { text, author } = parseClientReferenceId(clientReferenceId);
    if (!text) {
      logger.warn("Session missing secret text", { sessionId, clientReferenceId });
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
      category: guessCategory(text),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "stripe",
      stripeSessionId: sessionId,
      paymentStatus: session.payment_status || "unknown",
    });

    res.status(200).send("OK");
  }
);
