const admin = require("firebase-admin");

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Missing GOOGLE_APPLICATION_CREDENTIALS env var.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

const seedSecrets = [
  {
    text: "I still replay one argument from 2018 and wish I had apologized sooner.",
    author: "Anonymous",
    category: "guilt",
  },
  {
    text: "I moved to a new city and pretend I'm doing great, but most nights I eat dinner in silence.",
    author: "M",
    category: "sadness",
  },
  {
    text: "I paid off my mom's utility bill without telling her and she called it a miracle.",
    author: "quiethelper",
    category: "joy",
  },
  {
    text: "I keep a note in my phone of things I never say out loud.",
    author: "Anonymous",
    category: "general",
  },
  {
    text: "I pretended I forgot my dad's birthday because I was too embarrassed that I still can't forgive him.",
    author: "nobody_special",
    category: "guilt",
  },
  {
    text: "I laugh at work all day and then sit in my car for ten extra minutes before driving home because I don't want to be alone yet.",
    author: "Anonymous",
    category: "sadness",
  },
  {
    text: "A stranger paid for my coffee last winter and I've paid it forward every Friday since.",
    author: "C",
    category: "joy",
  },
  {
    text: "I wrote my resignation letter three times this month and never sent it.",
    author: "Anonymous",
    category: "general",
  },
  {
    text: "I judged someone for years before learning we were carrying the same fear.",
    author: "A.",
    category: "guilt",
  },
  {
    text: "I started taking sunrise walks, and for the first time in months I feel like I might be okay.",
    author: "Anonymous",
    category: "joy",
  },
];

async function run() {
  const batch = db.batch();

  seedSecrets.forEach((secret, index) => {
    const docRef = db.collection("secrets").doc(`seed-${String(index + 1).padStart(2, "0")}`);
    batch.set(docRef, {
      ...secret,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "seed",
    });
  });

  await batch.commit();
  console.log(`Seeded ${seedSecrets.length} secrets into collection: secrets`);
}

run()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.app().delete();
  });
