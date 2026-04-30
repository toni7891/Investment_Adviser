import { state } from "./state.js";
import { showToast } from "./ui.js";

const escapeHtml = (text) => {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
};

function addChatMessage(content, isUser) {
  const chatMessages = document.getElementById("chatMessages");
  if (!chatMessages) return;
  const div = document.createElement("div");
  div.className = `message ${isUser ? "user" : "bot"}`;
  div.innerHTML = `<p>${escapeHtml(content)}</p>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

export async function handleSendMessage() {
  const chatInput    = document.getElementById("chatInput");
  const sendButton   = document.getElementById("sendButton");
  const chatMessages = document.getElementById("chatMessages");
  const webSearchToggle = document.getElementById("webSearchToggle");

  const message = chatInput?.value.trim();
  if (!message) return;

  addChatMessage(message, true);
  chatInput.value = "";
  if (sendButton) sendButton.disabled = true;

  const loadingId  = "loading-" + Date.now();
  const loadingDiv = document.createElement("div");
  loadingDiv.id        = loadingId;
  loadingDiv.className = "message bot loading";
  loadingDiv.innerHTML = `<p><em>AI is thinking…</em></p>`;
  chatMessages?.appendChild(loadingDiv);
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const response = await fetch("/api/chat", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        portfolio_id:   state.currentPortfolioId || "",
        use_web_search: webSearchToggle?.checked ?? true,
      }),
    });
    const data = await response.json();
    document.getElementById(loadingId)?.remove();
    if (!response.ok) {
      addChatMessage(`Error: ${data.detail || "AI request failed."}`, false);
    } else {
      addChatMessage(data.response, false);
    }
  } catch {
    document.getElementById(loadingId)?.remove();
    addChatMessage("Error: Connection failed. Is the AI backend running?", false);
  } finally {
    if (sendButton) sendButton.disabled = false;
    chatInput?.focus();
  }
}

export function initChat() {
  const sendButton = document.getElementById("sendButton");
  const chatInput  = document.getElementById("chatInput");
  sendButton?.addEventListener("click", handleSendMessage);
  chatInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  });
}
