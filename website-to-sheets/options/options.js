function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Request failed"));
        return;
      }
      resolve(response.result);
    });
  });
}

const extensionIdEl = document.getElementById("extensionId");
const authLine = document.getElementById("authLine");
const status = document.getElementById("status");
const redirectUri = document.getElementById("redirectUri");
const redirectUriTop = document.getElementById("redirectUriTop");
const webClientId = document.getElementById("webClientId");
const webClientStatus = document.getElementById("webClientStatus");
const operaCallout = document.getElementById("operaCallout");

extensionIdEl.textContent = chrome.runtime.id;

if (operaCallout && !/\bOPR\/|\bOpera\b/i.test(navigator.userAgent)) {
  operaCallout.style.display = "none";
}

async function refreshAuth() {
  try {
    const { signedIn } = await send("AUTH_CHECK");
    authLine.textContent = signedIn
      ? "Signed in with Google — ready to save rows."
      : "Not signed in yet.";
  } catch (err) {
    authLine.textContent = `Auth check failed: ${err.message}`;
  }
}

async function refreshWebClient() {
  try {
    const data = await send("GET_WEB_CLIENT_ID");
    const uri = data.redirectUri || "(unavailable in this browser)";
    redirectUri.textContent = uri;
    if (redirectUriTop) redirectUriTop.textContent = uri;
    webClientId.value = data.clientId || "";
  } catch (err) {
    redirectUri.textContent = err.message;
    if (redirectUriTop) redirectUriTop.textContent = err.message;
  }
}

document.getElementById("signIn").addEventListener("click", async () => {
  status.textContent = "Opening Google sign-in…";
  try {
    if (!webClientId.value.trim() && /\bOPR\/|\bOpera\b/i.test(navigator.userAgent)) {
      status.textContent =
        "Save a Web application Client ID above first (Opera cannot use the Chrome Extension client alone).";
      return;
    }
    await send("AUTH_SIGN_IN");
    status.textContent = "Signed in.";
    await refreshAuth();
  } catch (err) {
    status.textContent = err.message;
  }
});

document.getElementById("signOut").addEventListener("click", async () => {
  try {
    await send("AUTH_SIGN_OUT");
    status.textContent = "Signed out.";
    await refreshAuth();
  } catch (err) {
    status.textContent = err.message;
  }
});

document.getElementById("saveWebClient").addEventListener("click", async () => {
  try {
    await send("SET_WEB_CLIENT_ID", { clientId: webClientId.value.trim() });
    webClientStatus.textContent = "Saved. Now click Sign in with Google.";
    await refreshWebClient();
  } catch (err) {
    webClientStatus.textContent = err.message;
  }
});

refreshAuth();
refreshWebClient();
