import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  collection,
  getFirestore,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const MAX_SECRETS = 100000;
const STRIPE_PLACEHOLDER_URL = "https://buy.stripe.com/eVqaEZ4FE4SH4pF8KE0Ny00";
const MOBILE_BREAKPOINT = 560;
const BATCH_SIZE_DESKTOP = 48;
const BATCH_SIZE_MOBILE = 24;
const MAX_SECRET_LENGTH = 200;
const MAX_AUTHOR_LENGTH = 40;
const STRIPE_REFERENCE_MAX_LENGTH = 200;
const FIRESTORE_PAGE_SIZE = 120;
const FIRESTORE_REALTIME_HEAD_SIZE = 40;

const firebaseConfig = window.__FIREBASE_CONFIG__ || {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_FIREBASE_APP_ID",
};

function hasPlaceholderFirebaseConfig(config) {
  const values = [config?.apiKey, config?.authDomain, config?.projectId, config?.appId]
    .map((value) => String(value || ""));
  return values.some((value) => value.includes("YOUR_"));
}

const categoryLabels = {
  guilt: "Guilt / Regret",
  sadness: "Sadness / Vulnerability",
  joy: "Joy / Wholesome",
  general: "General / Observation",
};

const secretsGrid = document.getElementById("secretsGrid");
const scarcityCounter = document.getElementById("scarcityCounter");
const cardTemplate = document.getElementById("cardTemplate");
const feedStatus = document.getElementById("feedStatus");
const loadMoreBtn = document.getElementById("loadMoreBtn");

const modal = document.getElementById("secretModal");
const openModalBtn = document.getElementById("openModalBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const secretForm = document.getElementById("secretForm");
const secretText = document.getElementById("secretText");
const authorAlias = document.getElementById("authorAlias");
const charCounter = document.getElementById("charCounter");
const paymentStatus = document.getElementById("paymentStatus");

let allSecrets = [];
let renderedCount = 0;
let lastVisibleDoc = null;
let hasMoreFromServer = true;
let isFetchingNextPage = false;
let realtimeUnsubscribe = null;
let firestoreDb = null;

function setPaymentStatus(message) {
  if (!paymentStatus) {
    return;
  }
  paymentStatus.textContent = message;
  paymentStatus.classList.remove("hidden");
}

function normalizeCategory(category) {
  return ["guilt", "sadness", "joy", "general"].includes(category)
    ? category
    : "general";
}

function formatRemainingCount(totalSecrets) {
  const remaining = Math.max(0, MAX_SECRETS - totalSecrets);
  return `${remaining.toLocaleString()} / ${MAX_SECRETS.toLocaleString()} Secrets Remaining`;
}

function createCard(secret) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  const text = (secret.text || "").trim();
  const author = (secret.author || "").trim() || "Anonymous";
  const category = normalizeCategory((secret.category || "").trim().toLowerCase());

  node.dataset.category = category;
  node.querySelector(".secret-card__text").textContent = text || "[No secret text]";
  node.querySelector(".secret-card__author").textContent = `By ${author}`;
  node.querySelector(".secret-card__category").textContent = categoryLabels[category];

  return node;
}

function getBatchSize() {
  return window.innerWidth <= MOBILE_BREAKPOINT
    ? BATCH_SIZE_MOBILE
    : BATCH_SIZE_DESKTOP;
}

function updateFeedControls() {
  const total = allSecrets.length;
  feedStatus.textContent = `Showing ${renderedCount.toLocaleString()} of ${total.toLocaleString()} secrets`;
  if (renderedCount < total || hasMoreFromServer) {
    loadMoreBtn.classList.remove("hidden");
    return;
  }
  loadMoreBtn.classList.add("hidden");
}

function renderNextBatch() {
  const batchSize = getBatchSize();
  const nextCount = Math.min(renderedCount + batchSize, allSecrets.length);
  const fragment = document.createDocumentFragment();

  for (let idx = renderedCount; idx < nextCount; idx += 1) {
    fragment.appendChild(createCard(allSecrets[idx]));
  }

  secretsGrid.appendChild(fragment);
  renderedCount = nextCount;
  updateFeedControls();
}

function rerenderFromTop() {
  renderedCount = 0;
  secretsGrid.innerHTML = "";
  scarcityCounter.textContent = formatRemainingCount(allSecrets.length);
  if (allSecrets.length > 0) {
    renderNextBatch();
    return;
  }
  updateFeedControls();
}

function showFallbackMessage(message) {
  secretsGrid.innerHTML = "";
  const fallback = document.createElement("article");
  fallback.className = "secret-card";
  fallback.dataset.category = "general";
  fallback.innerHTML = `<p class="secret-card__text">${message}</p>`;
  secretsGrid.appendChild(fallback);
  feedStatus.textContent = "";
  loadMoreBtn.classList.add("hidden");
}

function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("payment");
  if (!status) {
    return;
  }

  if (status === "success") {
    setPaymentStatus("Payment confirmed. Your secret will appear once Stripe webhook processes it.");
  } else if (status === "cancel") {
    setPaymentStatus("Payment canceled.");
  }

  const cleanUrl = `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, "", cleanUrl);
}

function mapSecretDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    text: data.text || "",
    author: data.author || "Anonymous",
    category: normalizeCategory((data.category || "general").toLowerCase()),
  };
}

async function fetchNextSecretsPage(db) {
  if (!hasMoreFromServer || isFetchingNextPage) {
    return;
  }

  isFetchingNextPage = true;
  try {
    let nextQuery = query(
      collection(db, "secrets"),
      orderBy("createdAt", "desc"),
      limit(FIRESTORE_PAGE_SIZE)
    );

    if (lastVisibleDoc) {
      nextQuery = query(
        collection(db, "secrets"),
        orderBy("createdAt", "desc"),
        startAfter(lastVisibleDoc),
        limit(FIRESTORE_PAGE_SIZE)
      );
    }

    const snapshot = await getDocs(nextQuery);
    if (snapshot.empty) {
      hasMoreFromServer = false;
      updateFeedControls();
      return;
    }

    lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1];
    const existingIds = new Set(allSecrets.map((secret) => secret.id));
    const newSecrets = snapshot.docs
      .map(mapSecretDoc)
      .filter((secret) => !existingIds.has(secret.id));

    allSecrets = [...allSecrets, ...newSecrets];
    if (snapshot.docs.length < FIRESTORE_PAGE_SIZE) {
      hasMoreFromServer = false;
    }
    scarcityCounter.textContent = formatRemainingCount(allSecrets.length);
  } finally {
    isFetchingNextPage = false;
  }
}

function listenToLatestSecretsRealtime(db) {
  if (realtimeUnsubscribe) {
    realtimeUnsubscribe();
  }

  const realtimeQuery = query(
    collection(db, "secrets"),
    orderBy("createdAt", "desc"),
    limit(FIRESTORE_REALTIME_HEAD_SIZE)
  );

  realtimeUnsubscribe = onSnapshot(
    realtimeQuery,
    (snapshot) => {
      const latestSecrets = snapshot.docs.map(mapSecretDoc);
      const latestIds = new Set(latestSecrets.map((secret) => secret.id));
      const olderSecrets = allSecrets.filter((secret) => !latestIds.has(secret.id));
      allSecrets = [...latestSecrets, ...olderSecrets];
      rerenderFromTop();
    },
    () => {
      if (allSecrets.length === 0) {
        scarcityCounter.textContent = formatRemainingCount(0);
        showFallbackMessage("Unable to load secrets right now. Try refreshing in a moment.");
      }
    }
  );
}

async function initializeSecretsFeed() {
  if (hasPlaceholderFirebaseConfig(firebaseConfig)) {
    setPaymentStatus("Firebase is not configured. Add real Firebase web config in index.html.");
    scarcityCounter.textContent = formatRemainingCount(0);
    showFallbackMessage("Feed is offline: Firebase config placeholders are still set.");
    return;
  }

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  firestoreDb = db;

  try {
    await fetchNextSecretsPage(db);
    if (allSecrets.length === 0) {
      scarcityCounter.textContent = formatRemainingCount(0);
      showFallbackMessage("No secrets have been posted yet.");
      return;
    }

    rerenderFromTop();
    listenToLatestSecretsRealtime(db);
  } catch (error) {
    scarcityCounter.textContent = formatRemainingCount(0);
    showFallbackMessage("Unable to load secrets right now. Try refreshing in a moment.");
  }
}

function openModal() {
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
}

openModalBtn.addEventListener("click", openModal);
closeModalBtn.addEventListener("click", closeModal);
loadMoreBtn.addEventListener("click", async () => {
  if (!firestoreDb) {
    return;
  }
  if (renderedCount < allSecrets.length) {
    renderNextBatch();
    return;
  }

  if (!hasMoreFromServer) {
    updateFeedControls();
    return;
  }

  const previousCount = allSecrets.length;
  await fetchNextSecretsPage(firestoreDb);
  if (allSecrets.length > previousCount) {
    renderNextBatch();
    return;
  }
  updateFeedControls();
});

modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.classList.contains("hidden")) {
    closeModal();
  }
});

secretText.addEventListener("input", () => {
  if (secretText.value.length > MAX_SECRET_LENGTH) {
    secretText.value = secretText.value.slice(0, MAX_SECRET_LENGTH);
  }
  charCounter.textContent = `${secretText.value.length} / ${MAX_SECRET_LENGTH}`;
});

secretForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = secretText.value.trim().slice(0, MAX_SECRET_LENGTH);
  if (!text) {
    return;
  }

  const author = (authorAlias?.value || "").trim().slice(0, MAX_AUTHOR_LENGTH) || "Anonymous";
  const rawReference = `Secret: ${text} | By: ${author}`;
  const encodedReference = encodeURIComponent(rawReference).substring(0, STRIPE_REFERENCE_MAX_LENGTH);

  const checkoutUrl = new URL(STRIPE_PLACEHOLDER_URL);
  checkoutUrl.searchParams.set("client_reference_id", encodedReference);

  window.location.href = checkoutUrl.toString();
});

handlePaymentReturn();
initializeSecretsFeed();
