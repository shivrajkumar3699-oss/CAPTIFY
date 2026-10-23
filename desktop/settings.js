const form = document.getElementById("settings");
const saveButton = document.getElementById("save");
const message = document.getElementById("message");
const groqInput = document.getElementById("groq");
const geminiInput = document.getElementById("gemini");
const gemini2Input = document.getElementById("gemini2");

window.captifyDesktop.getSettingsStatus().then((status) => {
  if (status && status.hasGroqKey) message.textContent = "A Groq key is already saved. Enter it again to replace it.";
}).catch(() => {});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  message.textContent = "Encrypting settings and starting the local worker...";
  try {
    await window.captifyDesktop.saveSettings({
      groqApiKey: groqInput.value,
      geminiApiKey: geminiInput.value,
      geminiApiKey2: gemini2Input.value
    });
    message.textContent = "Settings saved.";
  } catch (error) {
    message.textContent = error && error.message ? error.message : "Could not save settings.";
    saveButton.disabled = false;
  }
});
