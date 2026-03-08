const MAX_SECRETS = 100000;
const STRIPE_PLACEHOLDER_URL = "https://buy.stripe.com/eVqaEZ4FE4SH4pF8KE0Ny00";
const MOBILE_BREAKPOINT = 560;
const BATCH_SIZE_DESKTOP = 48;
const BATCH_SIZE_MOBILE = 24;
const MAX_SECRET_LENGTH = 300;
const MAX_AUTHOR_LENGTH = 40;

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
let pendingSecretDraft = null;

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
  if (renderedCount < total) {
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

function showFallbackMessage(message) {
  secretsGrid.innerHTML = "";
  const fallback = document.createElement("article");
  fallback.className = "secret-card";
  fallback.dataset.category = "general";
  fallback.innerHTML = `<p class="secret-card__text">${message}</p>`;
  secretsGrid.appendChild(fallback);
}

function prependSecretAndRerender(secret) {
  allSecrets = [secret, ...allSecrets];
  renderedCount = 0;
  secretsGrid.innerHTML = "";
  scarcityCounter.textContent = formatRemainingCount(allSecrets.length);
  renderNextBatch();
}

function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("payment");
  if (!status) {
    return;
  }

  if (status === "success" && pendingSecretDraft) {
    prependSecretAndRerender(pendingSecretDraft);
    pendingSecretDraft = null;
    setPaymentStatus("Payment confirmed. Your secret is now posted.");
  } else if (status === "success") {
    setPaymentStatus("Payment confirmed.");
  } else if (status === "cancel") {
    setPaymentStatus("Payment canceled.");
  }

  const cleanUrl = `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, "", cleanUrl);
}

async function loadSecrets() {
  try {
    const response = await fetch("./data.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const apiSecrets = Array.isArray(data?.secrets) ? data.secrets : [];
    allSecrets = apiSecrets;
    renderedCount = 0;
    secretsGrid.innerHTML = "";
    scarcityCounter.textContent = formatRemainingCount(allSecrets.length);
    renderNextBatch();
    handlePaymentReturn();
  } catch (error) {
    scarcityCounter.textContent = formatRemainingCount(0);
    showFallbackMessage("Unable to load secrets right now. Try refreshing in a moment.");
    feedStatus.textContent = "";
    loadMoreBtn.classList.add("hidden");
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
loadMoreBtn.addEventListener("click", renderNextBatch);

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
  const categoryInput = secretForm.querySelector('input[name="category"]:checked');
  const category = normalizeCategory(categoryInput?.value || "general");
  const secret = {
    id: Date.now(),
    text,
    author,
    category,
  };

  pendingSecretDraft = secret;

  const checkoutUrl = new URL(STRIPE_PLACEHOLDER_URL);
  // Keep this compact for Stripe reference matching, while still unique per attempt.
  checkoutUrl.searchParams.set("client_reference_id", `${secret.id}-${category}`);
  // Extra context passed via URL params for owner-side review/publishing workflow.
  checkoutUrl.searchParams.set("secret_text", text);
  checkoutUrl.searchParams.set("author_name", author);
  checkoutUrl.searchParams.set("category", category);

  closeModal();
  setPaymentStatus("Stripe opened in a new tab. After payment, return here to see confirmation.");
  window.open(checkoutUrl.toString(), "_blank", "noopener,noreferrer");
});

loadSecrets();
