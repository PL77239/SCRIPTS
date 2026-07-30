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

extensionIdEl.textContent = chrome.runtime.id;

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

document.getElementById("signIn").addEventListener("click", async () => {
  status.textContent = "Opening Google sign-in…";
  try {
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

refreshAuth();
