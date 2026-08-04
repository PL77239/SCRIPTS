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
const redirectUriMid = document.getElementById("redirectUriMid");
const webClientId = document.getElementById("webClientId");
const webClientSecret = document.getElementById("webClientSecret");
const webClientStatus = document.getElementById("webClientStatus");
const secretHint = document.getElementById("secretHint");
const operaCallout = document.getElementById("operaCallout");

extensionIdEl.textContent = chrome.runtime.id;

if (operaCallout && !/\bOPR\/|\bOpera\b/i.test(navigator.userAgent)) {
  operaCallout.style.display = "none";
}

function setRedirectDisplays(uri) {
  const text = uri || "(unavailable in this browser)";
  redirectUri.textContent = text;
  if (redirectUriTop) redirectUriTop.textContent = text;
  if (redirectUriMid) redirectUriMid.textContent = text;
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
    setRedirectDisplays(data.redirectUri);
    webClientId.value = data.clientId || "";
    webClientSecret.value = "";
    secretHint.textContent = data.hasSecret
      ? "A client secret is already saved on this browser. Leave the secret field blank to keep it, or paste a new one to replace it."
      : "No client secret saved yet — required for Opera Web application sign-in.";
  } catch (err) {
    setRedirectDisplays(err.message);
  }
}

document.getElementById("signIn").addEventListener("click", async () => {
  status.textContent = "Opening Google sign-in…";
  try {
    const isOpera = /\bOPR\/|\bOpera\b/i.test(navigator.userAgent);
    if (isOpera && !webClientId.value.trim()) {
      status.textContent =
        "Save a Web application Client ID (+ secret) above first.";
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
    const payload = { clientId: webClientId.value.trim() };
    // Only send secret when the user typed something (blank keeps existing).
    if (webClientSecret.value.trim()) {
      payload.clientSecret = webClientSecret.value.trim();
    }
    const data = await send("SET_WEB_CLIENT_ID", payload);
    webClientStatus.textContent = data.hasSecret
      ? "Saved. Add yourself as a Test user if needed, then click Sign in with Google."
      : "Client ID saved, but no secret yet — paste the Client secret and Save again.";
    await refreshWebClient();
  } catch (err) {
    webClientStatus.textContent = err.message;
  }
});

refreshAuth();
refreshWebClient();
