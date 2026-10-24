const form = document.getElementById("settings");
const saveButton = document.getElementById("save");
const message = document.getElementById("message");
const groqInput = document.getElementById("groq");
const geminiInput = document.getElementById("gemini");
const gemini2Input = document.getElementById("gemini2");

window.captifyDesktop.getSettingsStatus().then((status) => {
  if (status && status.hasGroqKey) {
    groqInput.placeholder = "Saved securely — leave blank to keep";
    geminiInput.placeholder = status.hasGeminiKey ? "Gemini key saved — leave blank to keep" : "AIza...";
    gemini2Input.placeholder = status.hasGeminiKey ? "Second key saved if configured — leave blank to keep" : "AIza...";
    message.textContent = "Your saved keys are stored securely. Leave any field blank to keep its saved value.";
  }
}).catch(() => {
  message.textContent = "Could not check saved-key status. You can still enter your keys again.";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  message.textContent = "Saving settings securely and starting the local worker...";
  try {
    const result = await window.captifyDesktop.saveSettings({
      groqApiKey: groqInput.value,
      geminiApiKey: geminiInput.value,
      geminiApiKey2: gemini2Input.value
    });
    if (!result || result.ok !== true) {
      message.textContent = result && result.error
        ? result.error
        : "Keys were saved, but the local worker did not start. Keep this window open and retry after checking the diagnostic message.";
      saveButton.disabled = false;
      return;
    }
    message.textContent = "Settings saved. CAPTIFY is starting.";
  } catch (error) {
    message.textContent = error && error.message ? error.message : "Could not save settings.";
    saveButton.disabled = false;
  }
});
